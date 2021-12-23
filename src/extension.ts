import { ChildProcessWithoutNullStreams, exec, spawn } from 'child_process';
import * as vscode from 'vscode';
import * as open from 'open';
import * as os from 'os';
import * as path from 'path';

const exists = require("command-exists");

let deckerProcess : ChildProcessWithoutNullStreams | null = null;
let statusBarItem: vscode.StatusBarItem;

let deckerCommand : string;

let logChannel = vscode.window.createOutputChannel("Decker Server: log");
let stdoutChannel = vscode.window.createOutputChannel("Decker Server: stdout");
let stderrChannel = vscode.window.createOutputChannel("Decker Server: stderr");

let extensionPath : string;

export function activate(context: vscode.ExtensionContext) {
	extensionPath = context.extensionPath;

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

	vscode.commands.registerCommand("decker-server.open-preview", () => {
		openPreview();
	});

	createStatusBarItem(context);
	updateStatusBarItem();

	if(config.get("server.autostart")) {
		startDeckerServer();
	}
}

function makePreviewHTML(htmlPath : string, cssPath : string) : string {
	return String.raw
`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${cssPath}">
	<title>Decker Preview</title>
</head>
<body>
	<iframe src="http://localhost:8888/${htmlPath}"></iframe> 
</body>
</html>`;
}

function makeErrorHTML(message : string, cssPath : string) : string {
	return String.raw
`<!DOCTYPE html>
<html lang="en" style="width: 100%; height: 100%;">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${cssPath}">
	<title>Error</title>
	</style>
</head>
<body>
	<h1>${message}</h1>
</body>
</html>`;
}

async function openPreview() {
	const editor = vscode.window.activeTextEditor;
	const panel : vscode.WebviewPanel = vscode.window.createWebviewPanel("previewPanel", "Decker Preview", vscode.ViewColumn.Two, {enableScripts: true});
	const cssURI : vscode.Uri = vscode.Uri.file(path.join(extensionPath, "res", "webview.css"));
	const webviewURI : vscode.Uri = panel.webview.asWebviewUri(cssURI);
	if(!deckerProcess) {
		await startDeckerServer();
		if(!deckerProcess) {
			panel.webview.html = makeErrorHTML("Unable to start a decker server in the workbench directory.", webviewURI.toString());
			return;
		}
	}
	if(editor) {
		const htmlPath : string | undefined = getDocumentHTMLPath(editor.document);
		if(htmlPath) {
			panel.webview.html = makePreviewHTML(htmlPath, webviewURI.toString());
		} else {
			panel.webview.html = makeErrorHTML("Preview was not opened in a markdown file.", webviewURI.toString());
		}
	} else {
		panel.webview.html = makeErrorHTML("No active document.", webviewURI.toString());
	}

}

function getDocumentHTMLPath(document : vscode.TextDocument) : string | undefined {
	let fileName = document.fileName;
	if(fileName) {
		let relative = vscode.workspace.asRelativePath(fileName);
		if(relative.endsWith(".md")) {
			return relative.replace(".md", ".html");
		} else {
			return undefined;
		}
	}
	return undefined;
}

async function openBrowser() {
	const editor = vscode.window.activeTextEditor;
	if(!editor) {
		vscode.window.showErrorMessage("No active document.");
		return;
	}
	if(!deckerProcess) {
		await startDeckerServer();
		if(!deckerProcess) {
			return;
		}
	}
	let path = getDocumentHTMLPath(editor.document);
	if(path) {
		open(`http://localhost:8888/${path}`);
	} else {
		open("http://localhost:8888");
	}
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

async function updateStatusBarItem() {
	const running = await isRunning("decker");
	if(running) {
		if(deckerProcess) { //Running, and we actually hava a handle to a process so it is us running it.
			statusBarItem.text = "$(play) Decker Server Running";
		} else { //Running, but we have no handle to the process, so it is running externally.
			statusBarItem.text = "$(play) External Decker Server Running";
		}
	} else { //Not running at all.
		statusBarItem.text = "$(warning) Decker Server Offline";
	}
}

async function startDeckerServer() {
	const installed : boolean = await checkedInstalled();
	if (installed) {
		const running : boolean = await isRunning("decker");
		if (running) {
			vscode.window.showInformationMessage("A decker server is already running on this system.");
			updateStatusBarItem();
		} else {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders) {
				vscode.window.showErrorMessage("No workspace is open to start a decker server in.");
				return;
			}
			const workspaceDirecotry = workspaceFolders[0].uri.fsPath;
			deckerProcess = spawn(deckerCommand, ["--server"], { cwd: workspaceDirecotry, env: process.env });
			deckerProcess.stdout.on("data", (data) => {
				stdoutChannel.appendLine(data.toString());
			});
			deckerProcess.stderr.on("data", (data) => {
				stderrChannel.appendLine(data.toString());
			});
			deckerProcess.on("close", (code) => {
				vscode.window.showInformationMessage("Decker Server terminated.");
				if (code) {
					logChannel.appendLine(`[DECKER CLOSE] Server closed with exitcode: ${code}`);
				} else {
					logChannel.appendLine(`[DECKER CLOSE] Server Closed`);
				}
			});
			deckerProcess.on("error", (error) => {
				logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
			});
			vscode.window.showInformationMessage(`Started Decker Server in: ${workspaceDirecotry}`);
			updateStatusBarItem();
		}
	} else {
		showInstallWebview();
		updateStatusBarItem();
	}
}

async function stopDeckerServer() {
	const running = await isRunning("decker");
	if(running) {
		if(deckerProcess) {
			deckerProcess.kill();
			deckerProcess = null;
		}
	}
	updateStatusBarItem();
}

async function isRunning (query : string) : Promise<boolean> {
	const platform = process.platform;
	let cmd = "";
	switch(platform) {
		case "win32" : cmd = "tasklist"; break;
		case "darwin" : cmd = "ps -ax"; break;
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

function getStorageDirectory(context: vscode.ExtensionContext){
	let storage: string | undefined = vscode.workspace.getConfiguration('decker-server').get('storagePath');
	if(!storage) {
		storage = context.globalStorageUri.fsPath;
	} else {
		storage.replace("${HOME}", os.homedir).replace("${home}", os.homedir).replace(/^~/, os.homedir);
		if(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]) {
			let folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
			storage.replace("${workspaceFolder}", folder).replace("${workspaceRoot}", folder);
		}
	}
	return storage;
}

//TODO Get this from github once migration is done
function getCurrentDeckerVersion() : string {
	return "0.11";
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
    <title>Install Decker</title>
</head>
<body>
    <h1>Install decker</h1>
	<p>We could not find decker on your system.</p>
	<a href="https://elearning.uni-wuerzburg.de/decker/" style="width: 256px; height: 64px;">Please download decker here</a>
</body>
</html>`;