(() => {
  const canvases = ['canvas-nails', 'canvas-art', 'canvas-original'];

  const artCanvasScale = 4;
  const lineWidth = 4;
  const nailRadius = 2;
  const nailLoopLimit = 5;
  const strAroundNail = 0.2;

  // Cheers: https://stackoverflow.com/a/4672319/1406230
  const brasenham = (from, to, cb) => {
    const dx = Math.abs(to[0]-from[0]);
    const dy = Math.abs(to[1]-from[1]);
    const sx = (from[0] < to[0]) ? 1 : -1;
    const sy = (from[1] < to[1]) ? 1 : -1;

    let err = dx - dy;
    let cx = from[0];
    let cy = from[1];

    while(true){
      cb(cx-nailRadius, cy-nailRadius);

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
  };

  Vue.component('art-view', {
    template: '#art-view-template',
    props: [
      'image',
      'width',
      'height',
      'nails',
      'strqty',
      'type'
    ],
    data () {
      return {
        show: false,
        curNail: 0,
        step: 0,
        distUsed: 0,
        nailsUsed: null,
        ogArt: null,
      }
    },
    computed: {
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

        const wog = this.image.width + 2*nailRadius;;
        const hog = this.image.height + 2*nailRadius;
        const wart = wog * artCanvasScale;
        const hart = hog * artCanvasScale;

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

        ctx.drawImage(this.image, nailRadius, nailRadius);

        // Cheers: https://www.htmlgoodies.com/html5/javascript/display-images-in-black-and-white-using-the-html5-canvas.html
        const dat = ctx.getImageData(
          nailRadius, nailRadius,
          this.image.width, this.image.height
        );

        const pixels = dat.data;
        for(let i = 0; i < pixels.length; i += 4) {
          const grey = pixels[i]*0.3 + pixels[i+1]*0.59 + pixels[i+2]*0.11;

          pixels[i] = grey;
          pixels[i+1] = grey;
          pixels[i+2] = grey;
        }

        ctx.putImageData(dat, nailRadius, nailRadius);
      },
      drawNails () {
        const w = this.image.width;
        const h = this.image.height;

        const canvas = this.$refs['canvas-nails'];
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = '#600';

        for(let i = 0; i < this.actualNumNails; i++) {
          const pos = this.nailPos(i, true);

          ctx.beginPath();
          ctx.arc(pos[0], pos[1], nailRadius*artCanvasScale, 0, 2*Math.PI);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(pos[0], pos[1], 1, 0, 2*Math.PI);
          ctx.stroke();
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
          x = nailRadius + dist;
          y = nailRadius;
          edge = 0;
        } else if(dist < w + h) {
          x = nailRadius + w - 1;
          y = nailRadius + (dist - w);
          edge = 1;
        } else if(dist < 2*w + h) {
          x = nailRadius + w - (dist - w - h) - 1;
          y = nailRadius + h - 1;
          edge = 2;
        } else {
          x = nailRadius;
          y = nailRadius + h - (dist - 2*w - h);
          edge = 3;
        }

        if(forArt) {
          x *= artCanvasScale;
          y *= artCanvasScale;
        }

        return [x, y, edge];
      },
      resetArt () {
        const printWidth =
          this.width *
          (1 + 2*(nailRadius/this.image.width));
        this.$refs['canvas-container'].style.setProperty('--cwidth', printWidth + 'cm');

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
          nailRadius, nailRadius,
          this.image.width, this.image.height
        ).data;

        this.ogArt = dat;
      },
      doArt () {
        if(this.type === 'preview') {
          while(this.distUsed < this.strqty) {
            this.doStep();
          }
        } else {
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

          brasenham(fpos, tpos, (x, y) => {
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
          this.distUsed = this.strqty;
          return;
        }

        brasenham(fpos, bestPos, (x, y) => {
          const i = y*this.image.width*4 + x*4;

          this.ogArt[i] = 255;
          this.ogArt[i+1] = 255;
          this.ogArt[i+2] = 255;
        });

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

        const artFpos = this.nailPos(this.curNail, true);
        const artBestPos = this.nailPos(bestNail, true);

        const canvas = this.$refs['canvas-art'];
        const ctx = canvas.getContext('2d');
        ctx.lineWidth = lineWidth;

        ctx.beginPath();
        ctx.moveTo(artFpos[0], artFpos[1]);
        ctx.lineTo(artBestPos[0], artBestPos[1]);
        ctx.stroke();

        this.curNail = bestNail;
      },
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
        strqty: null
      };
    },
    computed: {
      height () {
        if(!this.image) {
          return;
        }

        return Math.floor(this.width * (this.image.height/this.image.width) * 100) / 100
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
        console.log('prepareSpeech');
      }
    }
  });

  document.querySelector('#loading').remove();
})();
