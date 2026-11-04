/** 活动日记的定义：id、默认配置、构造与自描述。 */
import { describeTools, type WorldDefinition, type WorldDescribe } from 'cortico/world.ts';
import type { Language } from 'cortico/core/language.ts';
import { DIARY_DEFAULTS, type DiaryConfigSection } from './config.ts';
import { SCREEN_DIARY_ID, SCREEN_DIARY_TOOL_DECLS, ScreenDiaryWorld } from './world.ts';
import type { ModelLanguage } from './model-text.ts';

export interface DiaryAssembly {
  modelLanguage?: () => ModelLanguage;
  language?: () => Language;
}

const DESCRIBE: WorldDescribe = {
  tools: describeTools(
    SCREEN_DIARY_TOOL_DECLS.map(({ name, description, parameters, tags }) => ({ name, description, parameters, tags })),
    {
      diary_state: { zh: '读当前平滑后的活动状态与最近采样。', en: 'Reads the current smoothed activity state and recent samples.' },
      diary_recent: { zh: '读最近 10 个平滑状态采样，新的在前。', en: 'Reads the most recent smoothed state samples, newest first.' },
      diary_today: { zh: '按半小时分桶读某天的平滑状态，默认今天。', en: 'Reads one day of smoothed state in half-hour bins, today by default.' },
      diary_search: { zh: '显式回忆：在短期细节记录里搜索应用名、标题或速写。', en: 'Explicit recall over short-lived detail entries.' },
      diary_stats: { zh: '报覆盖天数、状态采样数与主要状态。', en: 'Reports days, state samples and dominant states.' },
    },
  ),
  events: [],
};

export function screenDiaryDefinition(assembly: DiaryAssembly = {}): WorldDefinition<DiaryConfigSection> {
  return {
    id: SCREEN_DIARY_ID,
    get label() {
      return assembly.language?.() === 'en' ? 'Activity diary' : '活动日记';
    },
    defaults: () => structuredClone(DIARY_DEFAULTS),
    create: (ctx) => new ScreenDiaryWorld({
      cfg: ctx.cfg,
      timezone: ctx.timezone,
      dataDir: ctx.dataDir,
      modelLanguage: () => assembly.modelLanguage?.() ?? 'zh',
      language: () => assembly.language?.() ?? 'zh',
    }),
    describe: DESCRIBE,
  };
}

export const SCREEN_DIARY = screenDiaryDefinition();
