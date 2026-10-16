// One pinned contract/profile shared by producers and both DS12 validators.
import {defaultSettings} from 'lighthouse/core/config/constants.js';
export const PERFORMANCE_CONTRACT='measured-v1';
export const N1_SHAPES=[300,1500,10000,15000,20000];
export const MOBILE_PROFILE=Object.freeze({formFactor:'mobile',throttlingMethod:'devtools',throttling:{...defaultSettings.throttling},screenEmulation:{...defaultSettings.screenEmulation},emulatedUserAgent:defaultSettings.emulatedUserAgent});
