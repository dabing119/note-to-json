import { COMPACT_RULES } from "./core/compact";
import { FORMAT_RULES, buildDefaultRuleMap } from "./core/rules";

export interface TidySettings {
  /** 格式化规则开关：规则 id → 是否启用 */
  formatRules: Record<string, boolean>;
  /** 简化规则开关：规则 id → 是否启用 */
  simplifyRules: Record<string, boolean>;
  /** 代码块缺语言时补充的语言，空串表示不补 */
  codeBlockDefaultLang: string;
  /** 是否弹出操作提示 */
  showNotice: boolean;
}

export const DEFAULT_SETTINGS: TidySettings = {
  formatRules: buildDefaultRuleMap(FORMAT_RULES),
  simplifyRules: buildDefaultRuleMap(COMPACT_RULES),
  codeBlockDefaultLang: "",
  showNotice: true,
};

/** 把已保存的数据与默认值合并，缺失或类型不符的字段回落到默认值 */
export function normalizeSettings(data: unknown): TidySettings {
  const stored = (data ?? {}) as Partial<TidySettings>;
  return {
    formatRules: { ...DEFAULT_SETTINGS.formatRules, ...(stored.formatRules ?? {}) },
    simplifyRules: { ...DEFAULT_SETTINGS.simplifyRules, ...(stored.simplifyRules ?? {}) },
    codeBlockDefaultLang:
      typeof stored.codeBlockDefaultLang === "string"
        ? stored.codeBlockDefaultLang
        : DEFAULT_SETTINGS.codeBlockDefaultLang,
    showNotice:
      typeof stored.showNotice === "boolean" ? stored.showNotice : DEFAULT_SETTINGS.showNotice,
  };
}
