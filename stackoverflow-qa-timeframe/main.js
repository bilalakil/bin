function App(container) {
    // -- Datasource Class ----------------------------------------------------
    // From the chart's perspective, the datasource is the source of truth for anything to do with the data.
    // The chart shouldn't have to worry about data manipulation at all - only display.
    //
    // The chart will get all data, formatted, filtered and sorted, from the datasource.
    // It will also work with the from and to times from the datasource.
    // Any modification to the data or time periods within the datasource should thus echo to the chart.
    var Datasource = (function() {
        // ---- StackOverflowLinearFetcher Private Class ------------
        // SO API querying has been separated from the rest of the datasource logic
        // in the form of this "private class".
        //
        // It's linear in the sense that questions are fetched linearly by creation date.
        // Specifically speaking, the `upTo` value provided in the `fetchedData` event
        // should only ever be greater than the previously provided value.
        //
        // The fetcher dispatches the `fetchedData` event with what's almost the raw question data.
        // The only modification is that the accepted answer is attached to the question,
        // beneath the `accepted_answer` key.
        function StackOverflowLinearFetcher(from, to, opts) {
            var self = this;

            function getFetchIntervals() {
                var start = from;

                if(useCache) {
                    start -= start % fetchInterval;
                }

                var intervals = [];

                while(start < to) {
                    intervals.push({
                        from: start,
                        to:   start + fetchInterval,
                        page: 0,
                        data: []
                    });

                    start += fetchInterval;
                }

                return intervals;
            }

            self.startFetching = function() {
                if(!fetchingStarted) {
                    fetchingStarted = true;

                    fetchAndRepeat();
                }
            }

            function fetchAndRepeat() {
                if(intervals.length == 0) {
                    Log.l("No more intervals to fetch.");

                    return;
                }

                var interval          = intervals[0],
                    cacheThisInterval = useCache && intervals.length > 1,
                    loggableInterval  =
                        Helper.formatTime(interval.from) + " to " +
                        Helper.formatTime(interval.to) +
                        " (page: " + (interval.page + 1) + ")",

                    now               = +new Date(),
                    nextFetchIn       = Time.second / 20,

                    questionData      = null,
                    questionCached    = null,
                    answerData        = null,
                    answerCached      = null,

                    questionUrl       = buildQuestionUrl(interval);

                Jsonp.get(questionUrl, function(data, fromCache) {
                    if(!data || data.error_id) {
                        if(fromCache) {
                            Log.l("Error in cache - clearing and trying again.");

                            Jsonp.uncache(questionUrl);
                            return scheduleNext();
                        }

                        Log.l("Error from SO while fetching question data, received:");
                        Log.l(data);

                        throw "Error from SO.";
                    }

                    questionData   = data;
                    questionCached = fromCache;

                    var answerIds  = getAnswerIds(questionData);
                    
                    if(answerIds.length == 0) {
                        return concludeSuccessfulFetch();
                    }

                    var answerUrl = buildAnswerUrl(interval, answerIds);

                    Jsonp.get(answerUrl, function(data, fromCache) {
                        if(!data || data.error_id) {
                            if(fromCache) {
                                Log.l("Error in cache - clearing and trying again.");

                                Jsonp.uncache(answerUrl);
                                return scheduleNext();
                            }

                            Log.l("Error from SO while fetching answer data, received:");
                            Log.l(data);

                            throw "Error from SO.";
                        }

                        answerData   = data;
                        answerCached = fromCache;

                        concludeSuccessfulFetch();
                    }, cacheThisInterval);
                }, cacheThisInterval);

                function concludeSuccessfulFetch() {
                    interval.data = interval.data.concat(combineQnAData(questionData, answerData));

                    if(questionData.has_more) {
                        interval.page += 1;
                    } else {
                        intervals.shift();

                        container.dispatch("fetchedData", { detail: {
                            data: interval.data,
                            upTo: interval.to
                        } });
                    }

                    scheduleNext();
                }

                function scheduleNext() {
                    var backoff = Helper.fromSOTime(Math.max(
                        !questionCached && questionData && questionData.backoff ? questionData.backoff : 0,
                        !answerCached && answerData && answerData.backoff ? answerData.backoff : 0
                    ));

                    if(backoff && backoff > nextFetchIn) {
                        Log.l("Will backoff for " + (backoff / 1000) + " seconds before next attempted fetch.");

                        nextFetchIn = backoff;
                    }

                    setTimeout(fetchAndRepeat, nextFetchIn);
                }
            }

            function buildQuestionUrl(interval) {
                return 'https://api.stackexchange.com/2.2/questions' + 
                    '?site=stackoverflow' +
                    '&pagesize=100&page=' + (interval.page + 1) +
                    '&sort=creation&order=asc' +
                    '&fromdate=' + Helper.toSOTime(interval.from) +
                    '&todate=' + Helper.toSOTime(interval.to) +
                    '&{callback}';
            }

            function getAnswerIds(questionData) {
                return questionData.items.map(function(question) {
                    return question.accepted_answer_id;
                }).filter(Boolean);
            }

            function buildAnswerUrl(interval, answerIds) {
                answerIds = answerIds.join(';');

                return 'https://api.stackexchange.com/2.2/answers/' + answerIds +
                    '?site=stackoverflow' +
                    '&pagesize=100' +
                    '&{callback}';
            }

            function combineQnAData(questionData, answerData) {
                if(questionData.items.length == 0) {
                    return [];
                }

                var questions = questionData.items;

                if(!answerData || answerData.items.length == 0) {
                    return questions;
                }

                var questionsByAnswerId = questions.reduce(function(map, question) {
                    if(!question.accepted_answer_id) {
                        return map;
                    }

                    map[question.accepted_answer_id] = question;

                    return map;
                }, {});

                answerData.items.forEach(function(answer) {
                    if(!(answer.answer_id in questionsByAnswerId)) {
                        return;
                    }

                    questionsByAnswerId[answer.answer_id].accepted_answer = answer;
                });

                return questions;
            }

            opts                = opts || {};

            var fetchingStarted = false,
                useCache        = "useCache" in opts ? opts.useCache : true,
                fetchInterval   = opts.fetchInterval || Time.hour,

                intervals       = getFetchIntervals();
        }

        // ---- Actual Datasource Class -----------------------------
        // Processes data from the fetcher into a pool which it holds on to.
        //
        // The `hasMoreData` event is triggered whenever the pool grows.
        // The `changedData` event is triggered when filters are modified.
        //
        // When `getData` is called, creates a copy of the pool
        // which is then filtered down to only applicable data.
        return function Datasource(from, to, opts) {
            var self = this;

            self.from = from;
            self.to = to;

            self.startFetching = function() {
                fetcher.startFetching();
            }

            function processFetchedData(data, upTo) {
                dataPool = dataPool.concat(
                    data.filter(function(question) {
                        var createdAt = Helper.fromSOTime(question.creation_date);

                        return createdAt >= from && createdAt < to;
                    }).map(function(question) {
                        var answeredAt = question.accepted_answer
                                ? Helper.fromSOTime(question.accepted_answer.creation_date)
                                : undefined;

                        if(answeredAt > to) {
                            answeredAt = undefined;
                        }

                        return {
                            id:         question.question_id,
                            createdAt:  Helper.fromSOTime(question.creation_date),
                            answeredAt: answeredAt,
                            numVotes:   question.score
                        }
                    })
                );

                self.hasUpTo = upTo;

                container.dispatch("hasMoreData");
            }

            self.getData = function(upTo) {
                var data = dataPool.filter(function(question) {
                    return question.createdAt <= upTo;
                });

                data = data.filter(filterVotes);

                return data;
            }

            function filterVotes(question) {
                return question.numVotes >= minNumVotes;
            }

            self.setFilters = function(filters) {
                filters = filters || {};

                if("minNumVotes" in filters) {
                    minNumVotes = filters.minNumVotes;
                }

                container.dispatch("changedData");
            }

            self.hasUpTo = 0; 

            opts            = opts || {};

            var fetcher     = new StackOverflowLinearFetcher(from, to, opts),

                dataPool    = [],
                
                minNumVotes = 1;

            container.on("fetchedData", function() {
                var e = d3.event.detail;

                processFetchedData(e.data, e.upTo);
            });
        }
    })();

    // -- Chart Class ---------------------------------------------------------
    // Takes data and the from and to times from the supplied datasource,
    // and displays them in the SVG chart as time progresses.
    function Chart(datasource, opts) {
        var self = this;

        function createChartElements() {
            svg = container.append("svg");

            innerG = svg.append("g")
                .attr("class", "inner");

            topXAxisG = svg.append("g")
                .attr("class", "top x axis");
            bottomXAxisG = svg.append("g")
                .attr("class", "bottom x axis");
        }

        function maybeStartTickerTimer() {
            if(
                tickerTimer ||
                tickTimeAt >= datasource.to ||
                datasource.hasUpTo < nextTickNeeds
            ) {
                return;
            }

            nextTick();
            update();

            tickerTimer = d3.interval(function() {
                if(tickTimeAt >= datasource.to) {
                    Log.l("Finished ticking!");

                    tickerTimer = tickerTimer.stop();
                    return;
                }

                if(datasource.hasUpTo < nextTickNeeds) {
                    Log.l("Stopping ticker: out of data.");

                    tickerTimer = tickerTimer.stop();
                    return;
                }

                nextTick();
                update();
            }, tickInterval);
        }

        function nextTick() {
            tickTimeAt    = nextTickNeeds;
            nextTickNeeds = Math.min(tickTimeAt + timeInOneTick, datasource.to);
        }

        function setSizes() {
            var rect = svg.node().getBoundingClientRect();

            fullWidth  = rect.width;
            fullHeight = rect.height;

            displayingTopXAxis = true;
            displayingTopYAxis = true;

            effectiveMargin = {
                top:    margin.top,
                right:  margin.right,
                bottom: margin.bottom,
                left:   margin.left
            };

            if(displayingTopXAxis) {
                effectiveMargin.top += horizontalAxisExtraMargin;
            }
            if(displayingBottomXAxis) {
                effectiveMargin.bottom += horizontalAxisExtraMargin;
            }

            innerWidth  = fullWidth - effectiveMargin.right - effectiveMargin.left;
            innerHeight = fullHeight - effectiveMargin.top - effectiveMargin.bottom;
        }

        function update() {
            tickData = datasource.getData(tickTimeAt);

            updateScales();
            updateAxes();
            updateInnerG();
        }

        function updateScales() {
            xScale = d3.scaleTime()
                .domain([datasource.from, tickTimeAt])
                .range([0, innerWidth]);

            yScale = d3.scaleLinear()
                .domain([0, tickData.length - 1])
                .range([0, innerHeight]);
        }

        function updateAxes() {
            topXAxisG.attr(
                "transform",
                "translate(" + effectiveMargin.right + "," +
                    (effectiveMargin.top - horizontalAxisSpacing) + ")"
            )
              .transition()
                .duration(tickInterval)
                .ease(d3.easeLinear)
                .call(d3.axisTop(xScale)
                    .ticks(xAxisInterval)
                    .tickFormat(Helper.formatTimeAxisTick)
                )
              .selectAll("line")
                .attr("class", Helper.timeAxisLineClass);

            bottomXAxisG.attr(
                "transform",
                "translate(" + effectiveMargin.right + "," +
                    (innerHeight + effectiveMargin.top + horizontalAxisSpacing) + ")"
            )
              .transition()
                .duration(tickInterval)
                .ease(d3.easeLinear)
                .call(d3.axisBottom(xScale)
                    .ticks(xAxisInterval)
                    .tickFormat(Helper.formatTimeAxisTick)
                )
              .selectAll("line")
                .attr("class", Helper.timeAxisLineClass)
                .attr("y1", 0 - innerHeight - horizontalAxisSpacing * 2);
        }

        function updateInnerG() {
            innerG.attr(
                "transform",
                "translate(" + effectiveMargin.left + "," + effectiveMargin.top + ")"
            );

            // Data join.
            var lines = innerG.selectAll("line")
                .data(tickData, function(d) { return d.id; });

            // Exit.
            lines.exit()
                .remove();

            // Enter.
            lines.enter()
                .append("line")
                .attr("stroke-opacity", 1e-6)
                .attr("x1", innerWidth)
                .attr("x2", innerWidth);

            // Update and enter.
            innerG.selectAll("line")
              .sort(sortData)
                // Handles `stroke-opacity`, `x1` and `x2`.
                .call(linearTweens)
                // Handles `transform` (which will translate `y`).
                .call(cubicTweens);
        }

        // TODO: Move sorting into the datasource. 
        // Tried it, but D3 wouldn't adhere to it for some reason.
        // More investigation required.
        function sortData(d1, d2) {
            // Answered before unanswered, ascending by duration.
            var d1Answered = d1.answeredAt ? d1.answeredAt <= tickTimeAt : false,
                d1Duration = (d1Answered ? d1.answeredAt : tickTimeAt) - d1.createdAt,
                d2Answered = d2.answeredAt ? d2.answeredAt <= tickTimeAt : false,
                d2Duration = (d2Answered ? d2.answeredAt : tickTimeAt) - d2.createdAt;

            if(d1Answered == d2Answered) {
                if(d1Duration == d2Duration) {
                    return d1.id < d2.id ? 1 : -1;
                }

                return d1Duration - d2Duration;
            } else if(d1Answered) {
                return -1;
            }
            return 1;
        }

        function linearTweens(lines) {
            d3.select(linearTweenLock)
              .transition()
                .duration(tickInterval)
                .ease(d3.easeLinear)
                .tween("attr:stroke-opacity", function() {
                    var interpolators = {};

                    lines.each(function(d, i) {
                        interpolators[d.id] = d3.interpolateNumber(
                            d3.select(this).attr("stroke-opacity"), 1
                        );
                    });

                    return function(t) {
                        lines.attr(
                            "stroke-opacity",
                            function(d, i) { return interpolators[d.id](t); }
                        )
                    };
                })
                .tween("attr:x1,x2", function() {
                    var x1Interpolators = {};
                    var x2Interpolators = {};

                    lines.each(function(d, i) {
                        x1Interpolators[d.id] = d3.interpolateNumber(
                            d3.select(this).attr("x1"),
                            xScale(d.createdAt)
                        );

                        var closeAt = d.answeredAt && d.answeredAt < tickTimeAt
                            ? d.answeredAt
                            : tickTimeAt;

                        x2Interpolators[d.id] = d3.interpolateNumber(
                            d3.select(this).attr("x2"),
                            xScale(closeAt)
                        );
                    });

                    return function(t) {
                        lines.attr("x1", function(d, i) { return x1Interpolators[d.id](t); });
                        lines.attr("x2", function(d, i) { return x2Interpolators[d.id](t); });
                    };
                });
        }

        function cubicTweens(lines) {
            d3.select(cubicTweenLock)
              .transition()
                .duration(tickInterval)
                .ease(d3.easeCubicOut)
                .tween("attr:transform", function() {
                    var interpolators = {};

                    lines.each(function(d, i) {
                        interpolators[d.id] = d3.interpolateTransformSvg(
                            d3.select(this).attr("transform"),
                            "translate(0," + yScale(i) + ")"
                        );
                    });

                    return function(t) {
                        lines.attr("transform", function(d, i) { return interpolators[d.id](t); });
                    };
                });
        }

        opts               = opts || {};

        var svg             = null,
            innerG          = null,
            topXAxisG       = null,
            bottomXAxisG    = null,
            
            tickInterval    = opts.tickInterval || Time.second / 2,
            speedup         = opts.speedup || 300,        // 5 minutes in 1 seconds.
            timeInOneTick   = tickInterval * speedup,

            tickData        = [],
            tickTimeAt      = datasource.from,
            nextTickNeeds   = tickTimeAt + timeInOneTick,
            tickerTimer     = null,
            
            fullWidth       = null,
            fullHeight      = null,

            margin          = opts.margin || {
                top: 20,
                right: 20,
                bottom: 20,
                left: 20
            },
            
            effectiveMargin = null,
            innerWidth      = null,
            innerHeight     = null,

            xAxisInterval   = opts.xAxisInterval || d3.timeMinute.every(15),
            horizontalAxisExtraMargin = opts.horizontalAxisExtraMargin || 15,
            horizontalAxisSpacing     = opts.horizontalAxisSpacing || 6,
            displayingTopXAxis        = true,
            displayingBottomXAxis     = true,
            
            xScale          = null,
            yScale          = null,
            
            linearTweenLock = {},
            cubicTweenLock  = {};

        createChartElements();
        setSizes();
        maybeStartTickerTimer();

        if(!tickerTimer) {
            update();
        }

        d3.select(window).on("resize", function() {
            setSizes();
            update();
        });

        container.on("hasMoreData", maybeStartTickerTimer);
        container.on("changedData", update);
    }

    // -- Helper Class --------------------------------------------------------
    function Helper() {}

    Helper.formatTime = function(time) { return new Date(time); }

    Helper.toSOTime = function(time) { return parseInt(time / 1000); }
    Helper.fromSOTime = function(soTime) { return soTime * 1000; }

    Helper.formatTimeAxisTick = function(d) {
        var hours = d.getHours(),
            mins  = d.getMinutes();

        if(mins == 0) {
            if(hours == 0) {
                return d3.timeFormat("%a %d")(d);
            }

            return d3.timeFormat("%I %p")(d);
        } else if(d.getMinutes() == 0) {
            return '';
        }
    };

    Helper.timeAxisLineClass = function(d) {
        var mins = d.getMinutes();

        if(mins == 0) {
            return "hour";
        } else if(mins == 30) {
            return "half-hour"
        } else {
            return "";
        }
    };

    // -- Time Class --------------------------------------------------------------
    var Time = function() {};

    Time.second = 1000;
    Time.minute = Time.second * 60;
    Time.hour = Time.minute * 60;

    // -- Jsonp Class -------------------------------------------------------------
    var Jsonp = function() {};

    Jsonp.canUseSessionStorage = Boolean(window.sessionStorage);

    Jsonp.get = function(url, cb, useCache) {
        if(!cb) {
            return;
        }

        if(Jsonp.canUseSessionStorage && useCache) {
            var data   = sessionStorage.getItem(url),
                parsed = false;

            try {
                data = JSON.parse(window.sessionStorage[url]);
                parsed = true;
            } catch(e) {
                Jsonp.uncache(url);
            }

            if(parsed) {
                cb(data, true);

                return;
            }
        }

        // Thanks to [this answer](https://stackoverflow.com/a/2499647) for help.
        var jsonpCallback = '_t_jsonp' + +new Date,
            scriptTag     = document.createElement('script'),
            parentEl      = document.documentElement;

        window[jsonpCallback] = function(data) {
            parentEl.removeChild(scriptTag);

            if(Jsonp.canUseSessionStorage && useCache) {
                try {
                    window.sessionStorage.setItem(url, JSON.stringify(data));
                } catch(e) {
                    window.sessionStorage.clear();
                }
            }

            cb(data, false);
        };

        scriptTag.src = url.replace('{callback}', 'callback=' + jsonpCallback);
        parentEl.appendChild(scriptTag);
    };

    Jsonp.uncache = function(url) {
        if(!Jsonp.canUseSessionStorage) {
            return;
        }

        sessionStorage.removeItem(url);
    };

    // -- Log Class -------------------------------------------------------
    function Log() {}
    
    Log.l = function(msg) {
        console.log(msg);
    }

    // -- App Class -------------------------------------------------------
    container      = d3.select(container);

    var to         = +new Date(),
        from       = to - Time.hour * 12,

        datasource = new Datasource(from, to),
        chart      = new Chart(datasource);

    datasource.startFetching();
};

var app = new App("#app-container");
