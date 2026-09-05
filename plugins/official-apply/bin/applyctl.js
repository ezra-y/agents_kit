#!/usr/bin/env node
/**
 * 启动壳。真正的逻辑在 bin/applyctl.ts。
 *
 * 这一层存在的唯一理由是：它是普通 JavaScript，任何版本的 Node 都跑得起来，
 * 所以「这台机器能不能跑 TypeScript」这个判断才有地方做（见 bin/launch.js）。
 */
import { launch } from './launch.js';

await launch('bin/applyctl.ts');
