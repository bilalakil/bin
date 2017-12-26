(() => {
  const canvases = ['canvas-nails', 'canvas-art', 'canvas-original'];

  const lineWidth = 4;
  const nailRadius = 6;
  const textHeight = 15;
  const numLetters = 4;
  const textSpace = textHeight * numLetters;
  const textToNailSpace = 4;
  const offset = nailRadius + textSpace + textToNailSpace;
  const nailLoopLimit = 5;
  const strAroundNail = 0.2;

  Vue.component('art-view', {
    template: '#art-view-template',
    props: [
      'image',
      'width',
      'height',
      'nails',
      'strqty',
      'type',
      'speechAllowed'
    ],
    data () {
      return {
        show: false,
        exhausted: false,
        curNail: 0,
        step: 0,
        distUsed: 0,
        nailsUsed: null,
        ogArt: null,

        hotkey: null,
        autoSpeed: 4,
        auto: false,
        pastLines: [],
        speech: false,

        pastLength: 5
      }
    },
    computed: {
      scale () {
        return (this.width*37) / this.image.width;
      },
      adjustedOffset () {
        return Math.ceil(offset / this.scale);
      },
      actualNumNails () {
        return Math.floor(this.nails/4)*4;
      }
    },
    methods: {
      doPreview () {
        if(!(
          this.image &&
          this.width &&
          this.actualNumNails &&
          this.strqty
        )) {
          return;
        }

        this.show = true;
        
        this.$nextTick(() => {
          this.setSizes();
          this.drawOriginal();
          this.drawNails();
          this.resetArt();
          this.doArt();
        });
      },
      setSizes () {
        const self = this;

        const wog = this.image.width + 2*this.adjustedOffset;
        const hog = this.image.height + 2*this.adjustedOffset;
        const wart = wog * this.scale;
        const hart = hog * this.scale;

        canvases.forEach((ref) => {
          const canvas = self.$refs[ref];

          if(ref === 'canvas-original') {
            canvas.width = wog;
            canvas.height = hog;
          } else {
            canvas.width = wart;
            canvas.height = hart;
          }
        });
      },
      drawOriginal () {
        const canvas = this.$refs['canvas-original'];
        const ctx = canvas.getContext('2d');

        ctx.drawImage(this.image, this.adjustedOffset, this.adjustedOffset);

        // Cheers: https://www.htmlgoodies.com/html5/javascript/display-images-in-black-and-white-using-the-html5-canvas.html
        const dat = ctx.getImageData(
          this.adjustedOffset, this.adjustedOffset,
          this.image.width, this.image.height
        );

        const pixels = dat.data;
        for(let i = 0; i < pixels.length; i += 4) {
          const grey = pixels[i]*0.3 + pixels[i+1]*0.59 + pixels[i+2]*0.11;

          pixels[i] = grey;
          pixels[i+1] = grey;
          pixels[i+2] = grey;
        }

        ctx.putImageData(dat, this.adjustedOffset, this.adjustedOffset);
      },
      drawNails () {
        const scaledOffset = this.adjustedOffset * this.scale;

        const canvas = this.$refs['canvas-nails'];
        const ctx = canvas.getContext('2d');
        ctx.font = '15px monospace';
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.lineWidth = 1;
        ctx.strokeStyle = '#000';
        ctx.rect(0, 0, canvas.width, canvas.height);
        ctx.stroke();
        ctx.rect(
          scaledOffset, scaledOffset,
          canvas.width - 2*scaledOffset, canvas.height - 2*scaledOffset
        );
        ctx.stroke();

        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = '#600';

        for(let i = 0; i < this.actualNumNails; i++) {
          const pos = this.nailPos(i, true);

          ctx.beginPath();
          ctx.arc(pos[0], pos[1], nailRadius, 0, 2*Math.PI);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(pos[0], pos[1], 1, 0, 2*Math.PI);
          ctx.stroke();

          if(i % 25 === 24) {
            ctx.fillStyle = '#600';
            ctx.font = 'bold 15px monospace';
          }

          const label = ('    ' + (i+1)).slice(-numLetters);
          if(pos[2] === 0 || pos[2] === 2) {
            const textx = pos[0] - nailRadius;
            const texty = pos[2] === 0
              ? 0
              : pos[1] + nailRadius + textToNailSpace;

            // Tricky pad: https://stackoverflow.com/a/14760377/1406230
            for(let l = 0; l < numLetters; l++) {
              ctx.fillText(label[l], textx, texty + l*textHeight);
            }
          } else {
            const textx = pos[2] === 1
              ? pos[0] + nailRadius + textToNailSpace
              : 0;
            const texty = pos[1] + nailRadius;

            ctx.fillText(label, textx, texty);
          }

          if(i % 25 === 24) {
            ctx.fillStyle = '#000';
            ctx.font = '15px monospace';
          }
        }
      },
      nailPos (nail, forArt) {
        const w = this.image.width;
        const h = this.image.height;
        const totalEdgeLength = w*2 + h*2;
        const distPerNail = totalEdgeLength / this.actualNumNails;

        const dist = Math.floor(nail * distPerNail);

        let x = undefined;
        let y = undefined;
        let edge = undefined;

        if(dist < w) {
          x = this.adjustedOffset + dist;
          y = this.adjustedOffset;
          edge = 0;
        } else if(dist < w + h) {
          x = this.adjustedOffset + w - 1;
          y = this.adjustedOffset + (dist - w);
          edge = 1;
        } else if(dist < 2*w + h) {
          x = this.adjustedOffset + w - (dist - w - h) - 1;
          y = this.adjustedOffset + h - 1;
          edge = 2;
        } else {
          x = this.adjustedOffset;
          y = this.adjustedOffset + h - (dist - 2*w - h);
          edge = 3;
        }

        if(forArt) {
          x *= this.scale;
          y *= this.scale;
        }

        return [x, y, edge];
      },
      resetArt () {
        const realWidth =
          this.width *
          (1 + 2*(this.adjustedOffset / this.image.width));
        this.$refs['canvas-container'].style.setProperty(
          '--canvaswidth',
          realWidth + 'cm'
        );

        const realHeight =
          this.height *
          (1 + 2*(this.adjustedOffset / this.image.height));
        this.$refs['canvas-container'].style.setProperty(
          '--canvasheight',
          realHeight + 'cm'
        );

        const canvas = this.$refs['canvas-art'];
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        this.curNail = 0;
        this.step = 0;
        this.distUsed = 0;
        this.nailsUsed = {[this.curNail]: 1};

        const og = this.$refs['canvas-original'];
        const ogCtx = og.getContext('2d');

        const dat = ogCtx.getImageData(
          this.adjustedOffset, this.adjustedOffset,
          this.image.width, this.image.height
        ).data;

        this.ogArt = dat;
      },
      doArt () {
        while(!this.exhausted && this.distUsed < this.strqty) {
          this.doStep();
        }
      },
      doStep () {
        const fpos = this.nailPos(this.curNail);

        let best = 256;
        let bestNail = undefined;
        let bestPos = undefined;

        for(let i = 0; i < this.actualNumNails; i++) {
          const tpos = this.nailPos(i);

          if(
            i === this.curNail ||
            (i in this.nailsUsed && this.nailsUsed[i] === nailLoopLimit) ||
            fpos[2] === tpos[2] ||
            (Math.min(this.curNail, i) === 0 && Math.max(fpos[2], tpos[2]) === 3)
          ) {
            continue;
          }

          let sum = 0;
          let count = 0;

          this.brasenham(fpos, tpos, (x, y) => {
            sum += this.ogArt[y*this.image.width*4 + x*4];
            count++;
          });

          const avg = sum / count;

          if(avg < best) {
            best = avg;
            bestNail = i;
            bestPos = tpos;
          }
        }

        if(bestNail === undefined) {
          this.exhausted = true;

          if(this.auto) {
            this.toggleAuto();
          }

          return;
        }

        this.brasenham(fpos, bestPos, (x, y) => {
          const i = y*this.image.width*4 + x*4;

          this.ogArt[i] = 255;
          this.ogArt[i+1] = 255;
          this.ogArt[i+2] = 255;
        });

        const oldDistUsed = this.distUsed;

        this.step++;
        this.distUsed += (
          this.width/this.image.width *
          Math.sqrt(Math.pow(bestPos[0] - fpos[0], 2) + Math.pow(bestPos[1] - fpos[1], 2))
          + strAroundNail
        ) / 100

        if(!(bestNail in this.nailsUsed)) {
          this.nailsUsed[bestNail] = 0;
        }
        this.nailsUsed[bestNail]++;

        const line = [this.curNail, bestNail];
        this.pastLines.unshift(line);
        if(this.pastLines.length === this.pastLength+1) {
          this.pastLines.pop();
        }

        const artFpos = this.nailPos(this.curNail, true);
        const artBestPos = this.nailPos(bestNail, true);

        const canvas = this.$refs['canvas-art'];
        const ctx = canvas.getContext('2d');
        ctx.lineWidth = lineWidth;

        if(this.type === 'stepper') {
          if(this.pastLines.length !== 1) {
            const prevPos = this.nailPos(this.pastLines[1][0], true);

            ctx.strokeStyle = '#000';
            
            ctx.beginPath();
            ctx.moveTo(artFpos[0], artFpos[1]);
            ctx.lineTo(prevPos[0], prevPos[1]);
            ctx.stroke();
          }

          ctx.strokeStyle = '#c00';
        }

        ctx.beginPath();
        ctx.moveTo(artFpos[0], artFpos[1]);
        ctx.lineTo(artBestPos[0], artBestPos[1]);
        ctx.stroke();

        if(this.speech) {
          const utt = new SpeechSynthesisUtterance('To ' + (bestNail+1));
          speechSynthesis.speak(utt);
        }

        this.curNail = bestNail;

        if(this.auto && oldDistUsed < this.strqty && this.distUsed >= this.strqty) {
          this.toggleAuto();
        }
      },
      // Cheers: https://stackoverflow.com/a/4672319/1406230
      brasenham (from, to, cb) {
        const dx = Math.abs(to[0]-from[0]);
        const dy = Math.abs(to[1]-from[1]);
        const sx = (from[0] < to[0]) ? 1 : -1;
        const sy = (from[1] < to[1]) ? 1 : -1;

        let err = dx - dy;
        let cx = from[0];
        let cy = from[1];

        while(true) {
          cb(cx - this.adjustedOffset, cy - this.adjustedOffset);

          if (cx === to[0] && cy === to[1]) {
            break;
          }

          const e2 = 2*err;
          if (e2 > -dy) {
            err -= dy;
            cx += sx;
          }
          if (e2 < dx) {
            err += dx;
            cy += sy;
          }
        }
      },
      toggleAuto () {
        if(this.auto) {
          clearInterval(this.auto);
          this.auto = null;
        } else {
          this.auto = setInterval(this.doStep, this.autoSpeed*1000);
        }
      },
      toggleSpeech () {
        if(this.speech) {
          speechSynthesis.cancel();
        }

        this.speech = !this.speech;
      }
    },
    watch: {
      autoSpeed () {
        if(!this.auto) {
          return;
        }

        this.toggleAuto();
        this.toggleAuto();
      }
    },
    mounted () {
      if(this.type !== 'preview') {
        this.$nextTick(() => {
          this.setSizes();
          this.drawNails();
          if(this.type === 'stepper') {
            this.drawOriginal();
          }
          this.resetArt();
        });
      }
      if(this.type === 'stepper') {
        this.speech = this.speechAllowed;

        const self = this;

        self.hotkey = document.addEventListener('keyup', (e) => {
          if(e.keyCode === 39) {
            self.doStep();
            e.preventDefault();
          } else if(e.keyCode === 32) {
            self.toggleAuto();
            e.preventDefault();
          }
        });
      }
    },
    beforeDestroy () {
      if(this.hotkey) {
        document.removeEventListener('keyup', this.hotkey);
      }
    }
  });

  new Vue({
    el: '#app',
    template: '#app-template',
    data () {
      return {
        step: 'config',
        loading: false,

        image: null,
        width: null,
        nails: null,
        strqty: null,

        speech: false,

        pageWidth: 18
      };
    },
    computed: {
      height () {
        if(!this.image) {
          return;
        }

        return Math.round(
          this.width *
          (this.image.height/this.image.width) * 100
        ) / 100
      },
      realWidth () {
        if(!(this.image && this.width)) {
          return;
        }

        const scale = (this.width*37) / this.image.width;
        const adjustedOffset = Math.ceil(offset / scale);

        return this.width *
          (1 + 2*(adjustedOffset / this.image.width));
      }
    },
    methods: {
      // Cheers: https://codepen.io/Atinux/pen/qOvawK
      imageChanged (e) {
        const self = this;

        const files = e.target.files;
        
        if(files.length === 0) {
          return;
        }

        const image = new Image();
        const reader = new FileReader();

        reader.onload = (e) => {
          image.src = e.target.result;
          self.image = image;
        };
        reader.readAsDataURL(files[0]);
      },
      doPreview () {
        const self = this;

        self.loading = true;

        // Can't find another way to wait for the loading text to show...
        self.$nextTick(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              self.$refs['art-view'].doPreview();
              self.loading = false;
            });
          });
        });
      },
      prepareSpeech () {
        try {
          const utt = new SpeechSynthesisUtterance('Speech ready!');
          speechSynthesis.speak(utt);

          this.speech = true;
        } catch(e) {
          alert('Unfortunately the speech synthesis API did not work.')
        }
      }
    }
  });

  document.querySelector('#loading').remove();
})();
