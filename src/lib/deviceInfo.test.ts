import { describe, it, expect } from "vitest";
import { detectBrowser, detectOS, detectDeviceType } from "./deviceInfo";

// Real-world user-agent strings for the platforms the app must serve.
// iOS/Android have no native app — they run the web app in the browser
// (WebGPU where available, ONNX/WASM everywhere), so correct platform
// detection is what routes them to a loadable engine.
const UA = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UD1A.230803.041) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.147 Mobile Safari/537.36",
  androidTabletChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.2535.85",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
};

describe("detectOS", () => {
  it("identifies iOS on iPhone and iPad", () => {
    expect(detectOS(UA.iosSafari)).toBe("iOS");
    expect(detectOS(UA.ipadSafari)).toBe("iOS");
  });

  it("identifies Android on phones and tablets", () => {
    // Android UAs contain "Linux" — Android must not be misread as desktop
    // Linux, or mobile users would get desktop-sized model suggestions.
    expect(detectOS(UA.androidChrome)).toBe("Android");
    expect(detectOS(UA.androidTabletChrome)).toBe("Android");
  });

  it("identifies the desktop OSes", () => {
    expect(detectOS(UA.macSafari)).toBe("macOS");
    expect(detectOS(UA.windowsEdge)).toBe("Windows");
    expect(detectOS(UA.linuxFirefox)).toBe("Linux");
  });

  it("returns Unknown rather than throwing on an unrecognized UA", () => {
    expect(detectOS("SomeBot/1.0")).toBe("Unknown");
  });
});

describe("detectBrowser", () => {
  it("identifies iOS Safari (the browser where only the ONNX/WASM engine runs)", () => {
    expect(detectBrowser(UA.iosSafari)).toMatch(/^Safari 17\.5/);
  });

  it("identifies Android Chrome", () => {
    expect(detectBrowser(UA.androidChrome)).toMatch(/^Chrome 125/);
  });

  it("does not misreport Edge as Chrome despite Chrome appearing in the UA", () => {
    expect(detectBrowser(UA.windowsEdge)).toMatch(/^Edge 125/);
  });

  it("identifies Firefox", () => {
    expect(detectBrowser(UA.linuxFirefox)).toMatch(/^Firefox 126/);
  });
});

describe("detectDeviceType", () => {
  it("classes iPhone and Android phones as mobile", () => {
    expect(detectDeviceType(UA.iosSafari)).toBe("mobile");
    expect(detectDeviceType(UA.androidChrome)).toBe("mobile");
  });

  it("classes iPad and Android tablets (no 'Mobile' token) as tablet", () => {
    expect(detectDeviceType(UA.ipadSafari)).toBe("tablet");
    expect(detectDeviceType(UA.androidTabletChrome)).toBe("tablet");
  });

  it("defaults to desktop for desktop UAs", () => {
    expect(detectDeviceType(UA.macSafari)).toBe("desktop");
    expect(detectDeviceType(UA.windowsEdge)).toBe("desktop");
  });
});
