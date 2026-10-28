/* Native fullscreen with a viewport-sized fallback and the existing controls, not copies. */
export class ViewerFullscreen {
  constructor({
    root,
    panel,
    mount,
    button,
    panelButton,
    canvas,
    controls,
    onResize,
  }) {
    Object.assign(this, {
      root,
      panel,
      mount,
      button,
      panelButton,
      canvas,
      onResize,
    });
    this.active = false;
    this.native = false;
    this.pending = false;
    this.restoreFocus = null;
    this.locations = controls.map((element) => {
      const marker = document.createComment(
        ` fullscreen home: ${element.id || element.className} `,
      );
      element.before(marker);
      return { element, marker };
    });
    button.onclick = () => (this.active ? this.close() : this.open());
    panelButton.onclick = () => this.setPanelHidden(!panel.hidden);
    document.addEventListener("fullscreenchange", () => {
      if (document.fullscreenElement === root) {
        if (!this.active) {
          document.exitFullscreen().catch(() => {});
          return;
        }
        this.native = true;
        this.root.dataset.fullscreen = "native";
      } else if (this.native) {
        this.native = false;
        this.deactivate();
      }
      this.resize();
    });
    document.addEventListener("keydown", (event) => {
      if (this.active && event.key === "Tab") {
        const items = [
          ...root.querySelectorAll("button, input, select, [tabindex='0']"),
        ].filter(
          (element) => !element.disabled && element.getClientRects().length,
        );
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      if (this.active && event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    });
  }
  resize() {
    requestAnimationFrame(() => this.onResize());
  }
  setPanelHidden(hidden) {
    this.panel.hidden = hidden;
    this.root.classList.toggle("controls-hidden", hidden);
    this.panelButton.textContent = hidden ? "Show controls" : "Hide controls";
    this.panelButton.setAttribute("aria-expanded", String(!hidden));
    this.resize();
  }
  activate() {
    this.restoreFocus = document.activeElement;
    this.active = true;
    this.root.classList.add("is-immersive");
    this.root.dataset.fullscreen = "expanded";
    document.body.classList.add("viewer-expanded");
    for (const { element } of this.locations) this.mount.append(element);
    this.panelButton.hidden = false;
    this.setPanelHidden(false);
    this.button.textContent = "⛶ Exit full screen";
    this.button.setAttribute("aria-label", "Exit fullscreen building view");
    this.button.setAttribute("aria-pressed", "true");
    this.canvas.focus({ preventScroll: true });
    this.resize();
  }
  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.native = false;
    for (const { element, marker } of this.locations) marker.after(element);
    this.panel.hidden = true;
    this.panelButton.hidden = true;
    this.root.classList.remove("is-immersive", "controls-hidden");
    this.root.dataset.fullscreen = "off";
    document.body.classList.remove("viewer-expanded");
    this.button.textContent = "⛶ Full screen";
    this.button.setAttribute("aria-label", "Enter fullscreen building view");
    this.button.setAttribute("aria-pressed", "false");
    if (this.restoreFocus?.isConnected)
      this.restoreFocus.focus({ preventScroll: true });
    this.resize();
  }
  async open() {
    if (this.active || this.pending) return;
    this.pending = true;
    this.activate();
    try {
      if (this.root.requestFullscreen)
        await this.root.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // Restricted/unsupported browsers retain an expanded view with the same exit controls.
      if (this.active) this.root.dataset.fullscreen = "expanded";
    } finally {
      this.pending = false;
      this.resize();
    }
  }
  async close() {
    if (document.fullscreenElement === this.root) {
      try {
        await document.exitFullscreen();
      } catch {
        this.canvas.focus({ preventScroll: true });
        return;
      }
    }
    this.deactivate();
  }
}
