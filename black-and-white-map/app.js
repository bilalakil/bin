const vapp = new Vue({
  el: '#app',
  template: '#app-template',
  data () {
    return {
      map: null,

      lat: -33.865,
      lng: 151.209444,
      zoom: 13,

      fontFamily: 'Open Sans',
      baseSize: 1.0,

      line1: {
        text: 'SYDNEY',
        size: 3.5,
        weight: 700,
        spacing: 0.3
      },
      line2: {
        text: 'AUSTRALIA',
        size: 1.5,
        weight: 400,
        spacing: 0.3
      },

      controlsEnabled: false,
    }
  },

  computed: {
    prettyLat() {
      return Math.abs(this.lat).toFixed(3)
    },
    prettyLng() {
      return Math.abs(this.lng).toFixed(3)
    }
  },

  mounted () {
    this.map = new google.maps.Map(document.getElementById('map'), {
      zoom: this.zoom,
      center: { lat: this.lat, lng: this.lng },
      disableDefaultUI: true,
      styles: mapStyle
    })

    this.map.addListener('center_changed', event => {
      const center = this.map.getCenter()

      this.lat = center.lat()
      this.lng = center.lng()
    })

    document.getElementById('app').focus()
  },

  watch: {
    lat () { this.recenter() },
    lng () { this.recenter() },
    zoom () {
      if(!this.zoom) { return }

      this.map.setZoom(this.zoom)
    }
  },

  methods: {
    toggleControls () {
      this.controlsEnabled = !this.controlsEnabled

      document.getElementById('app').focus()
    },

    recenter () {
      if(!this.lat || !this.lng) { return }

      this.map.setCenter({ lat: this.lat, lng: this.lng })
    }
  }
})
