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
      diary_today: { zh: '按天读活动日记，默认今天，按小时列出前台切换与视觉速写。', en: 'Reads one day of the activity diary, today by default.' },
      diary_search: { zh: '按应用名、窗口标题、速写或正文搜索活动日记。', en: 'Searches the diary by app, title, caption or text.' },
      diary_stats: { zh: '报日记总条数、覆盖天数与最常出现的应用。', en: 'Reports counts, days covered and the most seen apps.' },
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
