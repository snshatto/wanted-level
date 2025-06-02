const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let wantedLevelApp = null;

class WantedLevelApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #isDragging = false;
  #dragOffsetX = 0;
  static LONG_PRESS_THRESHOLD = 150;
  #starStates = ["empty", "empty", "empty", "empty", "empty"];

  constructor(options = {}) {
    super(options);
    const savedPanelLeft = game.settings.get("wanted-level", "panelLeft");
    this.panelLeft = savedPanelLeft !== null && savedPanelLeft !== undefined ? savedPanelLeft : null;
    const savedStates = game.settings.get("wanted-level", "starStates");
    if (Array.isArray(savedStates) && savedStates.length === 5) {
      this.#starStates = savedStates;
    }
  }

  static DEFAULT_OPTIONS = {
    id: "wanted-level-dialog",
    classes: ["wanted-level"],
    tag: "section",
    window: { frame: false },
    position: { width: "auto", height: "auto" }
  };

  static PARTS = {
    main: { template: "modules/wanted-level/templates/wanted-level.hbs" }
  };

  async _prepareContext(context) {
    const starColor = game.settings.get("wanted-level", "starColor") || "#FFD700";
    return {
      starStates: this.#starStates,
      starColor: starColor
    };
  }

  // Helper to lighten a hex color by a percentage
  lightenColor(hex, percent) {
    // Remove '#' and parse the hex color
    hex = hex.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Lighten each channel
    const lightenChannel = (channel) => Math.min(255, Math.floor(channel + (255 - channel) * (percent / 100)));
    const newR = lightenChannel(r);
    const newG = lightenChannel(g);
    const newB = lightenChannel(b);

    // Convert back to hex
    return `#${newR.toString(16).padStart(2, "0")}${newG.toString(16).padStart(2, "0")}${newB.toString(16).padStart(2, "0")}`;
  }

  // Public method to update star states and re-render
  updateStarStates(newStates) {
    if (Array.isArray(newStates) && newStates.length === 5) {
      this.#starStates = newStates;
      const savedPanelLeft = game.settings.get("wanted-level", "panelLeft");
      this.panelLeft = savedPanelLeft !== null && savedPanelLeft !== undefined ? savedPanelLeft : null;
      this.render();
    }
  }

  async _onRender(context, options) {
    super._onRender(context, options);

    this.element.classList.add("dark");

    // Use this.element for drag functionality
    const tab = this.element;
    if (!tab) {
      return;
    }

    tab.style.transition = "none";
    tab.classList.add("visible");

    // Fetch panelLeft fresh from settings to ensure persistence
    const savedPanelLeft = game.settings.get("wanted-level", "panelLeft");
    this.panelLeft = savedPanelLeft !== null && savedPanelLeft !== undefined ? savedPanelLeft : null;

    // Calculate tab width dynamically after rendering
    const tabWidth = tab.offsetWidth || 160; // Default to 160px if not set
    const viewportWidth = window.innerWidth;
    const minLeft = 0; // Allow tab to touch left edge
    const maxLeft = viewportWidth - tabWidth; // Allow tab to touch right edge
    const defaultLeft = (viewportWidth - tabWidth) / 2;
    const tabLeft = this.panelLeft !== null ? Math.clamp(this.panelLeft, minLeft, maxLeft) : defaultLeft;

    // Debug log before adjustment
    console.log("onRender - savedPanelLeft:", savedPanelLeft, "panelLeft:", this.panelLeft, "tabLeft:", tabLeft, "element left:", tab.style.left);

    Object.assign(tab.style, {
      left: `${tabLeft}px`,
      top: "0px !important",
      position: "fixed",
      margin: "0"
    });

    // Delayed adjustment to enforce position after render cycle
    setTimeout(() => {
      if (this.panelLeft !== null) {
        tab.style.left = `${Math.clamp(this.panelLeft, minLeft, maxLeft)}px`;
        console.log("postRender - enforced left:", tab.style.left); // Debug log
      }
    }, 0);

    tab.offsetHeight; // Force reflow
    tab.style.transition = "";

    // Apply star color and hover effect
    const starColor = game.settings.get("wanted-level", "starColor") || "#FFD700";
    const hoverColor = this.lightenColor(starColor, 20); // Lighten by 20% for hover
    const stars = tab.querySelectorAll(".clickable-star");
    stars.forEach(star => {
      star.style.color = starColor;
      star.style.transition = "color 0.2s ease"; // Smooth color transition on hover
      star.addEventListener("mouseover", () => {
        star.style.color = hoverColor;
      });
      star.addEventListener("mouseout", () => {
        star.style.color = starColor;
      });
    });

    // Attach click event listeners to stars (GM only for editing)
    for (let i = 1; i <= 5; i++) {
      const star = tab.querySelector(`#star-${i}`);
      if (star) {
        // Visually indicate editability: cursor style
        star.style.cursor = game.user.isGM ? "pointer" : "default";

        star.addEventListener("click", (event) => {
          event.stopPropagation();
          // Only allow GM to edit star states
          if (!game.user.isGM) return;

          const clickedIndex = i - 1;
          const currentState = this.#starStates[clickedIndex];

          if (currentState === "empty") {
            this.#starStates = this.#starStates.map((state, index) => {
              if (index < clickedIndex) return "filled";
              if (index === clickedIndex) return "half";
              return "empty";
            });
          } else if (currentState === "half") {
            this.#starStates = this.#starStates.map((state, index) => {
              if (index < clickedIndex) return "filled";
              if (index === clickedIndex) return "filled";
              return "empty";
            });
          } else if (currentState === "filled") {
            this.#starStates = this.#starStates.map((state, index) => {
              if (index < clickedIndex) return this.#starStates[index];
              if (index === clickedIndex) return "empty";
              return "empty";
            });
          }

          // Persist the new state (world-scoped, so all clients see the update)
          game.settings.set("wanted-level", "starStates", this.#starStates);
          // Broadcast custom event to all clients
          game.socket.emit("module.wanted-level", {
            type: "updateStars",
            starStates: this.#starStates
          });
        });
      }
    }

    let longPressTimer = null;
    let pressStartTime = 0;

    const handleMouseDown = (event) => {
      event.preventDefault();
      pressStartTime = Date.now();
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        this.#isDragging = true;
        this.#dragOffsetX = event.clientX - (parseFloat(getComputedStyle(tab).left) || 0);
        Object.assign(tab.style, {
          position: "fixed",
          transform: "none", // Remove centering transform during drag
          userSelect: "none",
          margin: "0",
          top: "0px !important"
        });
      }, WantedLevelApp.LONG_PRESS_THRESHOLD);

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    };

    const handleMouseMove = (event) => {
      if (!this.#isDragging) return;
      const newTabLeft = Math.clamp(
        event.clientX - this.#dragOffsetX,
        minLeft,
        maxLeft
      );
      tab.style.left = `${newTabLeft}px`;
    };

    const handleMouseUp = (event) => {
      event.preventDefault();
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      if (this.#isDragging) {
        this.#isDragging = false;
        const newTabLeft = Math.clamp(
          event.clientX - this.#dragOffsetX,
          minLeft,
          maxLeft
        );
        Object.assign(tab.style, {
          left: `${newTabLeft}px`,
          userSelect: "",
          top: "0px !important"
        });
        console.log("Saving panelLeft:", newTabLeft); // Debug log
        game.settings.set("wanted-level", "panelLeft", newTabLeft); // Save final position
        this.panelLeft = newTabLeft; // Update instance variable
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    tab.addEventListener("mousedown", handleMouseDown);
  }

  async close(options = {}) {
    this.element.classList.remove("visible");
    this.element.remove();
    wantedLevelApp = null;
    return super.close(options);
  }
}

Hooks.once("init", () => {
  // Register the "add" helper for Handlebars
  Handlebars.registerHelper("add", function(a, b) {
    return Number(a) + Number(b);
  });

  // Register a helper to get the star class based on state
  Handlebars.registerHelper("getStarClass", function(state) {
    if (state === "half") return "fa-regular fa-star-sharp-half-stroke";
    if (state === "filled") return "fa-solid fa-star-sharp";
    return "fa-regular fa-star-sharp";
  });

  game.settings.register("wanted-level", "panelLeft", {
    name: "Panel Position",
    scope: "client", // Client-scoped so each player has their own position
    config: false,
    type: Number,
    default: null
  });

  game.settings.register("wanted-level", "starStates", {
    name: "Star States",
    scope: "world", // World-scoped so all players see the GM's changes
    config: false,
    type: Array,
    default: ["empty", "empty", "empty", "empty", "empty"]
  });

  game.settings.register("wanted-level", "starColor", {
    name: game.i18n.localize("WANTED_LEVEL.ColorSettingName"),
    hint: game.i18n.localize("WANTED_LEVEL.ColorSettingHint"),
    scope: "world", // World-scoped, editable by GM
    config: true,
    default: "#FFD700",
    type: String,
    restricted: true, // Only GM can change
    onChange: value => {
      if (wantedLevelApp) wantedLevelApp.render();
    }
  });

  // Register socket handler for custom events
  game.socket.on("module.wanted-level", (data) => {
    if (data.type === "updateStars" && wantedLevelApp) {
      console.log("Received updateStars:", data.starStates); // Debug log
      wantedLevelApp.updateStarStates(data.starStates);
    }
  });
});

Hooks.on("ready", () => {
  if (game.modules.get("wanted-level")?.active && !wantedLevelApp) {
    wantedLevelApp = new WantedLevelApp();
    wantedLevelApp.render(true);
  }
});

// Listen for updates to starStates to re-render the tab for all players
Hooks.on("updateSetting", (setting) => {
  if (setting.key === "wanted-level.starStates" && wantedLevelApp) {
    console.log("Setting updated:", setting.key, setting.value); // Debug log
    wantedLevelApp.updateStarStates(setting.value);
  }
});