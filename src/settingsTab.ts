import { App, PluginSettingTab, Setting } from "obsidian";
import { COMPACT_RULES } from "./core/compact";
import { FORMAT_RULES } from "./core/rules";
import type MarkdownTidyPlugin from "./main";

export class TidySettingTab extends PluginSettingTab {
  private readonly tidy: MarkdownTidyPlugin;

  constructor(app: App, plugin: MarkdownTidyPlugin) {
    super(app, plugin);
    this.tidy = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("格式化规则").setHeading();
    for (const rule of FORMAT_RULES) {
      new Setting(containerEl)
        .setName(`${rule.id} ${rule.name}`)
        .setDesc(rule.description)
        .addToggle((toggle) =>
          toggle
            .setValue(this.tidy.settings.formatRules[rule.id] !== false)
            .onChange(async (value) => {
              this.tidy.settings.formatRules[rule.id] = value;
              await this.tidy.saveSettings();
            })
        );
    }

    new Setting(containerEl).setName("简化规则").setHeading();
    for (const rule of COMPACT_RULES) {
      new Setting(containerEl)
        .setName(`${rule.id} ${rule.name}`)
        .setDesc(rule.description)
        .addToggle((toggle) =>
          toggle
            .setValue(this.tidy.settings.simplifyRules[rule.id] !== false)
            .onChange(async (value) => {
              this.tidy.settings.simplifyRules[rule.id] = value;
              await this.tidy.saveSettings();
            })
        );
    }

    new Setting(containerEl).setName("其他").setHeading();

    new Setting(containerEl)
      .setName("代码块默认语言")
      .setDesc("仅在规则 F11 开启时生效；留空表示不给代码块补语言")
      .addText((text) =>
        text
          .setPlaceholder("例如 text / js / python")
          .setValue(this.tidy.settings.codeBlockDefaultLang)
          .onChange(async (value) => {
            this.tidy.settings.codeBlockDefaultLang = value;
            await this.tidy.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("显示操作提示")
      .setDesc("关闭后格式化与简化完成时不再弹出提示")
      .addToggle((toggle) =>
        toggle.setValue(this.tidy.settings.showNotice).onChange(async (value) => {
          this.tidy.settings.showNotice = value;
          await this.tidy.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("快捷键")
      .setDesc("在「设置 → 快捷键」中搜索 Note to JSON，即可为四条命令重新绑定任意快捷键")
      .addButton((button) =>
        button
          .setButtonText("打开快捷键设置")
          .setCta()
          .onClick(() => {
            const settings = (this.app as unknown as {
              setting?: { open(): void; openTabById(id: string): void };
            }).setting;
            if (settings) {
              settings.open();
              settings.openTabById("hotkeys");
            }
          })
      );
  }
}
