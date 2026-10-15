/** Existing build behavior fixtures now name their schema2 application explicitly. */
import { build as realBuild } from '../../src/build';
import type { BuildConfig } from '../../src/types';
export const build = (config: BuildConfig) => realBuild({app: 'fixture', ...config});
