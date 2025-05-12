(() => {
  // node_modules/peakflow/src/script.ts
  var Script = class {
    element;
    constructor(src) {
      this.element = document.createElement("script");
      this.element.src = src;
    }
    addAttribute(name, value) {
      this.element.setAttribute(name, value);
    }
  };
  var Stylesheet = class {
    element;
    constructor(href) {
      this.element = document.createElement("link");
      this.element.setAttribute("rel", "stylesheet");
      this.element.href = href;
    }
    addAttribute(name, value) {
      this.element.setAttribute(name, value);
    }
  };

  // src/ts/webflow.config.ts
  var WEBFLOW_ENV = window.WEBFLOW_ENV;
  var WEBFLOW_CONFIG = window.WEBFLOW_CONFIG;
  var host;
  var csspath;
  var jspath;
  console.log("Webflow Environment:");
  console.log(WEBFLOW_ENV);
  console.log("Webflow CONFIG:");
  console.log(WEBFLOW_CONFIG);
  function buildWebflowConfig() {
    csspath = "assets/css";
    if (WEBFLOW_ENV.development) {
      jspath = "assets/js";
      host = "http://localhost:3000";
    } else if (WEBFLOW_ENV.production) {
      console.log("PRODUCTION = TRUE");
      jspath = "dist";
      host = "https://cdn.jsdelivr.net/gh/lukas-peakpoint/peakpoint@latest";
    } else {
      return;
    }
    WEBFLOW_CONFIG.js.forEach((file) => {
      let url = `${host}/dist/${file}.js`;
      let script = new Script(url);
      script.addAttribute("data-dyn-js", "true");
      document.body.appendChild(script.element);
      console.log("url: " + url);
      console.log(script);
    });
    WEBFLOW_CONFIG.css.forEach((file) => {
      let url = `${host}/${csspath}/${file}.css`;
      let stylesheet = new Stylesheet(url);
      stylesheet.addAttribute("data-dyn-js", "true");
      document.head.appendChild(stylesheet.element);
    });
    setTimeout(() => {
      const event = new CustomEvent("buildWebflowConfig");
      window.dispatchEvent(event);
    }, 200);
  }
  buildWebflowConfig();
})();
