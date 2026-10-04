"use strict";

const { Notice, PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_SETTINGS = {
  autoGenerate: true,
  generator: "local-template",
  endpoint: "http://127.0.0.1:11434/v1",
  model: ""
};

function normalizedSettings(value = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...(value && typeof value === "object" ? value : {})
  };
}

class BookCurationSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const service = this.plugin.bookCuration;
    const settings = normalizedSettings(service?.getSettings?.());
    containerEl.empty();

    containerEl.createEl("h2", { text: "梦藏 · 新书自动策展" });
    containerEl.createEl("p", {
      text: "新书被识别后，先生成不写入 Markdown 的阅读引线草案。只有读者在局部图中点击“确认”，引思句、问题和选中的作品节点才会写入笔记。"
    });

    new Setting(containerEl)
      .setName("新书自动生成")
      .setDesc("仅产生待审草案；不会因为自动生成而创建作品笔记。")
      .addToggle((toggle) => toggle
        .setValue(Boolean(settings.autoGenerate))
        .onChange(async (value) => {
          try {
            await service?.updateSettings?.({ autoGenerate: value });
          } catch (error) {
            new Notice(`无法保存策展设置：${error?.message || "未知错误"}`);
            this.display();
          }
        }));

    new Setting(containerEl)
      .setName("生成方式")
      .setDesc("基础引线完全不联网；本地模型只允许连接 localhost。")
      .addDropdown((dropdown) => dropdown
        .addOption("local-template", "基础引线（不联网）")
        .addOption("local-model", "本地模型（OpenAI-compatible）")
        .setValue(settings.generator)
        .onChange(async (value) => {
          try {
            await service?.updateSettings?.({ generator: value });
          } catch (error) {
            new Notice(`无法切换生成方式：${error?.message || "未知错误"}`);
          }
          this.display();
        }));

    const endpointSetting = new Setting(containerEl)
      .setName("本地接口")
      .setDesc("仅接受 127.0.0.1、localhost 或 ::1；不读取 Obsidian Copilot 的配置或密钥。")
      .addText((text) => {
        text
          .setPlaceholder("http://127.0.0.1:11434/v1")
          .setValue(settings.endpoint);
        text.inputEl.addEventListener("change", async () => {
          try {
            await service?.updateSettings?.({ endpoint: text.inputEl.value.trim() });
          } catch (error) {
            new Notice(`本地接口未保存：${error?.message || "请使用 localhost 地址"}`);
            this.display();
          }
        });
        text.inputEl.disabled = settings.generator !== "local-model";
      });
    endpointSetting.settingEl.toggleClass("is-disabled", settings.generator !== "local-model");

    const modelSetting = new Setting(containerEl)
      .setName("模型名称")
      .setDesc("例如你在 Ollama 或 LM Studio 中已经加载的本地模型。")
      .addText((text) => {
        text
          .setPlaceholder("例如 qwen3:8b")
          .setValue(settings.model);
        text.inputEl.addEventListener("change", async () => {
          try {
            await service?.updateSettings?.({ model: text.inputEl.value.trim() });
          } catch (error) {
            new Notice(`模型设置未保存：${error?.message || "未知错误"}`);
            this.display();
          }
        });
        text.inputEl.disabled = settings.generator !== "local-model";
      });
    modelSetting.settingEl.toggleClass("is-disabled", settings.generator !== "local-model");

    containerEl.createEl("h3", { text: "隐私与内容标注" });
    const notes = containerEl.createEl("ul");
    for (const copy of [
      "默认只使用标题、作者、摘要、标签等白名单字段，不发送 PDF、绝对路径或整个 Vault。",
      "自动文案始终标为“AI / 策展引思句 · 非作者原文”。",
      "作品关系标为“策展联想”；没有史料时不声称历史影响。",
      "馆藏页可打开不等于图片可转载，插件不会自动下载或嵌入作品图片。"
    ]) notes.createEl("li", { text: copy });
  }
}

module.exports = {
  BookCurationSettingTab,
  DEFAULT_SETTINGS,
  normalizedSettings
};
