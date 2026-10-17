// One pinned contract/profile shared by producers and both DS12 validators.
// Pinned Lighthouse13.5.0 preset. The browser producer checks this against the
// installed tool before launching; pure release-record checks need no browser tools.
export const PERFORMANCE_CONTRACT='measured-v1';
export const N1_SHAPES=[300,1500,10000,15000,20000];
export const MOBILE_PROFILE=Object.freeze({
  "formFactor": "mobile",
  "throttlingMethod": "devtools",
  "throttling": {
    "rttMs": 150,
    "throughputKbps": 1638.4,
    "requestLatencyMs": 562.5,
    "downloadThroughputKbps": 1474.5600000000002,
    "uploadThroughputKbps": 675,
    "cpuSlowdownMultiplier": 4
  },
  "screenEmulation": {
    "mobile": true,
    "width": 412,
    "height": 823,
    "deviceScaleFactor": 1.75,
    "disabled": false
  },
  "emulatedUserAgent": "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36"
});

// Strict startup qualification; v5 proves native navigation lifecycle origin
// without a duration heuristic. Application/unknown task limits are unchanged;
// historical failures remain failed and a fresh full campaign is required.
export const MOBILE_STARTUP_POLICY = Object.freeze({
 id:'N3-startup-strict50-v5',targetMs:50,maxTaskMs:50,
 runsPerRoute:20,responseAfterPaintMs:500,p95TbtMs:200,
});
