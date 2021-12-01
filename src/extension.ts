import { ChildProcessWithoutNullStreams, exec, spawn } from 'child_process';
import * as vscode from 'vscode';
import * as open from 'open';
const exists = require("command-exists");

let deckerProcess : ChildProcessWithoutNullStreams | null = null;
let statusBarItem: vscode.StatusBarItem;

let deckerCommand : string;

class Log {
	stdout: Array<string>;
	stderr: Array<string>;
	constructor() {
		this.stdout = [];
		this.stderr = [];
	}
};

let deckerLog : Log;

export function activate(context: vscode.ExtensionContext) {

	let config = vscode.workspace.getConfiguration('decker');
	let deckerCommandConfig : string | undefined = config.get("executable.command");
	deckerCommand = deckerCommandConfig ? deckerCommandConfig : "decker";

	vscode.commands.registerCommand("decker-server.start", () => {
		startDeckerServer();
	});
	vscode.commands.registerCommand("decker-server.stop", () => {
		stopDeckerServer();
	});
	vscode.commands.registerCommand("decker-server.toggle", () => {
		if(deckerProcess) {
			stopDeckerServer();
		} else {
			startDeckerServer();
		}
	});
	vscode.commands.registerCommand("decker-server.open-browser", () => {
		openBrowser();
	});

	createStatusBarItem(context);

	if(config.get("server.autostart")) {
		startDeckerServer();
	}
}

function openBrowser() {
	if(!deckerProcess) {
		startDeckerServer();
	}
	let fileName = vscode.window.activeTextEditor?.document.fileName;
	if(fileName) {
		let relative = vscode.workspace.asRelativePath(fileName);
		if(relative.endsWith(".md")) {
			let path = relative.replace(".md", ".html");
			open(`http://localhost:8888/${path}`);
			return;
		}
	}
	open("http://localhost:8888");

}

function showInstallWebview() {
	const panel = vscode.window.createWebviewPanel("previewPanel", "Decker Installation Configuration", vscode.ViewColumn.Two, {enableScripts: true});
	panel.webview.html = configHTML;
}

function createStatusBarItem(context: vscode.ExtensionContext) {
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
	statusBarItem.command = "decker-server.toggle";
	statusBarItem.text = "$(warning) Decker Server Offline";
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);
}

function updateStatusBarItem() {
	isRunning("decker").then((running) => {
		if(running) {
			if(deckerProcess) {
				statusBarItem.text = "$(play) Decker Server Running";
			} else {
				statusBarItem.text = "$(play) External Decker Server Running";
			}
		} else {
			statusBarItem.text = "$(warning) Decker Server Offline";
		}
	});
}

function startDeckerServer() {
	checkedInstalled().then((installed) => {
		if (installed) {
			isRunning("decker").then((running) => {
				if (running) {
					vscode.window.showInformationMessage("A decker server is already running on this system.");
					updateStatusBarItem();
					const workspaceFolders = vscode.workspace.workspaceFolders;
					if (!workspaceFolders) {
						return;
					}
					const workspaceDirecotry = workspaceFolders[0].uri.fsPath;
					deckerLog = new Log();
					deckerProcess = spawn(deckerCommand, ["--server"], { cwd: workspaceDirecotry, env: process.env });
					deckerProcess.stdout.on("data", (data) => {
						deckerLog.stdout.push(data.toString());
					});
					deckerProcess.stderr.on("data", (data) => {
						deckerLog.stderr.push(data.toString());
					});
					deckerProcess.on("close", (code) => {
						vscode.window.showInformationMessage("Decker Server terminated.");
						if (code) {
							console.log(`[DECKER CLOSE] Server closed with exitcode: ${code}`);
						} else {
							console.log(`[DECKER CLOSE] Server Closed`);
						}
					});
					deckerProcess.on("error", (error) => {
						console.error(error);
					});
					vscode.window.showInformationMessage(`Started Decker Server in: ${workspaceDirecotry}`);
					updateStatusBarItem();
				}
			});
		} else {
			showInstallWebview();
		}
	});
}

function stopDeckerServer() {
	isRunning("decker").then((running) => {
		if(running) {
			if(deckerProcess) {
				deckerProcess.kill();
				deckerProcess = null;
				deckerLog.stdout.forEach(console.log);
				deckerLog.stderr.forEach(console.error);
				updateStatusBarItem();
			}
		}
	});
}

async function isRunning (query : string) : Promise<boolean> {
	const platform = process.platform;
	let cmd = "";
	switch(platform) {
		case "win32" : cmd = "tasklist"; break;
		case "darwin" : cmd = "ps -ax | grep " + query; break;
		case "linux" : cmd = "ps -A"; break;
		default: break;
	}
	return new Promise<boolean>((resolve, reject) => {
		exec(cmd, (err, stdout, stderr) => {
			if(!err) {
				resolve(stdout.toLowerCase().indexOf(query.toLowerCase()) > -1);
			} else {
				reject(stderr);
			}
		});
	});
}

async function checkedInstalled(): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		exists(deckerCommand).then((/*command*/) => {
			resolve(true);
		}).catch((/*error*/) => {
			resolve(false);
		});
	});
}

export function deactivate() {
	stopDeckerServer();
}

const configHTML : string = String.raw
`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Configure Decker Server</title>
</head>
<body">
    <h1>Install decker</h1>
	<p>We could not find decker on your system.</p>
	<a href="https://elearning.uni-wuerzburg.de/decker/" style="width: 256px; height: 64px; background: white; color: black;">Please download decker here</a>
</body>
</html>`;