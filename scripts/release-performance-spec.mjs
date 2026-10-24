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

// L-66: trace-derived absence of application attribution is corroborated only
// by all forty complete, clean independent probes. Raw tasks and limits remain.
export const MOBILE_STARTUP_POLICY = Object.freeze({
 id:'N3-startup-correlated-v1',targetMs:50,maxTaskMs:50,
 runsPerRoute:20,responseAfterPaintMs:500,p95TbtMs:200,
});

// Classification and its historical strict summary above remain stable. This
// separately versioned product allowance applies only to positively proven
// cold-start tasks; independent observer/input tasks retain the strict ceiling.
export const MOBILE_OBSERVER_MAX_TASK_MS = 50;
export const MOBILE_STARTUP_ACCEPTANCE = Object.freeze({
 id:'N3-cold-start-bounded-v1',targetMs:50,maxExceptionalTaskMs:55,
 maxExceptionalTasks:2,maxAffectedVisits:2,maxExcessMs:10,runsPerRoute:20,
});
