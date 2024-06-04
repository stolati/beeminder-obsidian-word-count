import {MarkdownView, App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile} from 'obsidian';
import getWordCount from "./getWordCount";

enum WordCountScope {
	SELECTION	= "SELECTION",
	VAULT = "VAULT",
}

interface BeeminderWordCountSettings {
	userName: string,
	goalName: string,
	authToken: string,
	currentWordCnt: number,
	editingFileTitle: string,
	scope: WordCountScope,

}

const DEFAULT_SETTINGS: BeeminderWordCountSettings = {
	userName: "Alice",
	goalName: "weight",
	authToken: "",
	currentWordCnt: 0,
	editingFileTitle: "",
	scope: WordCountScope.SELECTION,
}

export default class BeeminderWordCountPlugin extends Plugin {
	settings: BeeminderWordCountSettings;

	async onload() {
		console.log('loading plugin');

		await this.loadSettings();

		this.addCommand({
			id: 'create-word-count-datapoint',
			name: 'Send word count to Beeminder',
			checkCallback: (checking: boolean) => {
				switch(this.settings.scope){
					case WordCountScope.SELECTION:
						const leaf = this.app.workspace.activeLeaf;
						if(! leaf) return false;
						break;
					case WordCountScope.VAULT:
						break;
				}

				if (!checking) {
					new BeeminderResponseModal(this.app, this.settings).open();
				}
				return true;
			}
		});

		this.registerInterval(
			window.setInterval(async () => {
				let activeLeaf = this.app.workspace.activeLeaf;
				let markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

				if (!markdownView) {
					return;
				}

				let editor = markdownView.editor;
				if (editor.somethingSelected()) {
					let content: string = editor.getSelection();
					this.settings.editingFileTitle = activeLeaf.getDisplayText();
					this.settings.currentWordCnt = getWordCount(content);
				}
			}, 500)
		);

		this.addSettingTab(new BeeminderWordCountSettingTab(this.app, this));
	}

	onunload() {
		console.log('unloading plugin');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class BeeminderResponseModal extends Modal {
	setting: BeeminderWordCountSettings;

	constructor(app: App, setting: BeeminderWordCountSettings) {
		super(app);
		this.setting = setting;
	}

	async onOpen() {
		let {contentEl} = this;
		const result = await this.createDataPoint();
		if (result.success) {
			contentEl.setText(`${result.wordCount} word count sent to Beeminder. Good work!`);
		} else {
			contentEl.setText(`Failed to create datapoint. ${result.body}`);
		}
	}

	onClose() {
		let {contentEl} = this;
		contentEl.empty();
	}

	// Thanks to https://github.com/jamiebrynes7/obsidian-todoist-plugin/blob/master/src/api/api.ts
	async createDataPoint() {
		const url = `https://www.beeminder.com/api/v1/users/${this.setting.userName}/goals/${this.setting.goalName}/datapoints.json`;
		let wordCount = this.setting.currentWordCnt

		let now = new Date();
		let title = `${now.toISOString()} - `
		switch(this.setting.scope){
			case WordCountScope.SELECTION:
				title += `${this.setting.editingFileTitle}`
				break;
			case WordCountScope.VAULT:
				title += `Vault ${this.app.vault.getName()}`
				wordCount = await this.countWordInVault()
				break;
		}

		console.log(`${wordCount} words in vault [${this.setting.scope}]`)

		let formData = new FormData();
		formData.append('auth_token', this.setting.authToken);
		formData.append('value', `${wordCount}`);
		formData.append('comment', title);

		const response = await fetch(url, {
			method: "POST",
			body: formData,
		});
		const text = await response.text();

		return {
			wordCount,
			success: response.ok,
			body: text,
		}
	}

	async countWordInVault() {
		let total_count = 0
		const contentPromises = this.app.vault.getMarkdownFiles().map( mdF => this.app.vault.read(mdF))
	 	for(const contentPromise of contentPromises){
			total_count += getWordCount(await contentPromise)
		}
		return total_count
	}

}

class BeeminderWordCountSettingTab extends PluginSettingTab {
	plugin: BeeminderWordCountPlugin;

	constructor(app: App, plugin: BeeminderWordCountPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for the Beeminder word count plugin'});

		this.createSetting('Beeminder auth_token', (val: string) => this.plugin.settings.authToken = val, this.plugin.settings.authToken);
		this.createSetting('Beeminder user name', (val: string) => this.plugin.settings.userName = val, this.plugin.settings.userName);
		this.createSetting('Beeminder goal name', (val: string) => this.plugin.settings.goalName = val, this.plugin.settings.goalName);

		new Setting(this.containerEl)
			.setName('Word count Scope')
			.addDropdown(
				dropdown => {
					for(const enumVal in WordCountScope){
						dropdown.addOption(enumVal, enumVal)
					}
					dropdown.setValue(this.plugin.settings.scope)
					dropdown.onChange((new_v: WordCountScope) => {
						this.plugin.settings.scope = new_v
					})
					return dropdown
				}
			)

	}

	createSetting(name: string, pluginFieldSetter: Function, default_val: string) {
		const callback = async (val: string) => {
			pluginFieldSetter(val);
			await this.plugin.saveSettings();
		}
		new Setting(this.containerEl)
			.setName(name)
			.addText(text => text
				.setValue(default_val)
				.onChange(callback)
			);
	}
}
