import { ChildProcessWithoutNullStreams, exec, spawn } from "child_process";
import * as nls from "vscode-nls";
import * as vscode from "vscode";
import * as open from "open";
import * as os from "os";
import * as path from "path";

const localize = nls.config({ messageFormat: nls.MessageFormat.file })();

const exists = require("command-exists");

let deckerProcess: ChildProcessWithoutNullStreams | null = null;
let deckerPort: number;

let statusBarItem: vscode.StatusBarItem;

let logChannel = vscode.window.createOutputChannel("Decker Server: log");
let stdoutChannel = vscode.window.createOutputChannel("Decker Server: stdout");
let stderrChannel = vscode.window.createOutputChannel("Decker Server: stderr");

let extensionPath: string;

export function activate(context: vscode.ExtensionContext) {
  extensionPath = context.extensionPath;

  let config = vscode.workspace.getConfiguration("decker");

  vscode.commands.registerCommand("decker-server.start", () => {
    startDeckerServer();
  });
  vscode.commands.registerCommand("decker-server.stop", () => {
    stopDeckerServer();
  });
  vscode.commands.registerCommand("decker-server.toggle", () => {
    if (deckerProcess) {
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
  vscode.commands.registerCommand(
    "decker-server.crunch",
    (directory: vscode.Uri) => {
      crunchVideos();
    }
  );
  vscode.commands.registerCommand(
    "decker-server.clean",
    (directory: vscode.Uri) => {
      cleanProject();
    }
  );
  vscode.commands.registerCommand(
    "decker-server.build",
    (directory: vscode.Uri) => {
      buildProject();
    }
  );
  vscode.commands.registerCommand(
    "decker-server.publish",
    (directory: vscode.Uri) => {
      publishProject();
    }
  );

  createStatusBarItem(context);
  updateStatusBarItem();

  if (config.get("server.autostart")) {
    startDeckerServer();
  }
}

function makePreviewHTML(htmlPath: string, cssPath: string): string {
  return String.raw`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${cssPath}">
	<title>Decker Preview</title>
</head>
<body>
	<iframe src="http://localhost:${deckerPort}/${htmlPath}"></iframe> 
</body>
</html>`;
}

function makeErrorHTML(message: string, cssPath: string): string {
  return String.raw`<!DOCTYPE html>
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
  const panel: vscode.WebviewPanel = vscode.window.createWebviewPanel(
    "previewPanel",
    "Decker Preview",
    vscode.ViewColumn.Two,
    { enableScripts: true }
  );
  const cssURI: vscode.Uri = vscode.Uri.file(
    path.join(extensionPath, "res", "webview.css")
  );
  const webviewURI: vscode.Uri = panel.webview.asWebviewUri(cssURI);
  if (!deckerProcess) {
    await startDeckerServer();
    if (!deckerProcess) {
      panel.webview.html = makeErrorHTML(
        "Unable to start a decker server in the workbench directory.",
        webviewURI.toString()
      );
      return;
    }
  }
  if (!!editor) {
    const htmlPath: string | undefined = getDocumentHTMLPath(editor.document);
    if (!!htmlPath) {
      panel.webview.html = makePreviewHTML(htmlPath, webviewURI.toString());
    } else {
      panel.webview.html = makeErrorHTML(
        "Preview was not opened in a markdown file.",
        webviewURI.toString()
      );
    }
  } else {
    panel.webview.html = makeErrorHTML(
      "No active document.",
      webviewURI.toString()
    );
  }
}

function getDocumentHTMLPath(
  document: vscode.TextDocument
): string | undefined {
  let fileName = document.fileName;
  if (fileName) {
    let relative = vscode.workspace.asRelativePath(fileName);
    if (relative.endsWith(".md")) {
      return relative.replace(".md", ".html");
    } else {
      return undefined;
    }
  }
  return undefined;
}

async function openBrowser() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active document.");
    return;
  }
  if (!deckerProcess) {
    await startDeckerServer();
    if (!deckerProcess) {
      return;
    }
  }
  let path = getDocumentHTMLPath(editor.document);
  if (path) {
    open(`http://localhost:${deckerPort}/${path}`);
  } else {
    open(`http://localhost:${deckerPort}`);
  }
}

function showInstallWebview() {
  const panel = vscode.window.createWebviewPanel(
    "previewPanel",
    "Decker Installation Configuration",
    vscode.ViewColumn.Two,
    { enableScripts: true }
  );
  panel.webview.html = configHTML;
}

function createStatusBarItem(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    1
  );
  statusBarItem.command = "decker-server.toggle";
  statusBarItem.text = "$(warning) Decker Server Offline";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

async function updateStatusBarItem() {
  if (!!deckerProcess) {
    statusBarItem.text = `$(play) Decker Server on http://localhost:${deckerPort}`;
  } else {
    statusBarItem.text = "$(warning) No Decker Server running in this session";
  }
}

function getDeckerCommand(fallback: string): string {
  let config = vscode.workspace.getConfiguration("decker");
  let configCommand: string | undefined = config.get("executable.command");
  let deckerCommand = configCommand ? configCommand : fallback;
  return deckerCommand;
}

function getDeckerPort(fallback: number): number {
  let config = vscode.workspace.getConfiguration("decker");
  let configPort: number | undefined = config.get("server.port");
  let deckerPort = configPort ? configPort : fallback;
  return deckerPort;
}

async function cleanProject() {
  let command = getDeckerCommand("decker");
  const installed: boolean = await checkedInstalled(command);
  if (!installed) {
    showInstallWebview();
    return;
  }
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage(
      "No workspace is open to clean a project in."
    );
    return;
  }
  const workspaceDirecotry = workspaceFolders[0].uri.fsPath;
  const localProcess = spawn(command, ["clean"], {
    cwd: workspaceDirecotry,
    env: process.env,
  });
  localProcess.stdout.on("data", (data) => {
    stdoutChannel.append(data.toString());
  });
  localProcess.stderr.on("data", (data) => {
    stderrChannel.append(data.toString());
  });
  localProcess.on("exit", (code) => {
    vscode.window.showInformationMessage("Finished cleaning project.");
    if (code) {
      logChannel.appendLine(`[DECKER EXIT] decker clean exitcode: ${code}`);
    } else {
      logChannel.appendLine(`[DECKER EXIT] decker clean`);
    }
  });
  localProcess.on("error", (error) => {
    logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
  });
}

async function buildProject() {
  let command = getDeckerCommand("decker");
  const installed: boolean = await checkedInstalled(command);
  if (!installed) {
    showInstallWebview();
    return;
  }
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage(
      "No workspace is open to run a decker command in."
    );
    return;
  }
  const workspaceDirecotry = workspaceFolders[0].uri.fsPath;
  const localProcess = spawn(command, [], {
    cwd: workspaceDirecotry,
    env: process.env,
  });
  localProcess.stdout.on("data", (data) => {
    stdoutChannel.append(data.toString());
  });
  localProcess.stderr.on("data", (data) => {
    stderrChannel.append(data.toString());
  });
  localProcess.on("exit", (code) => {
    vscode.window.showInformationMessage("Finished building project.");
    if (code) {
      logChannel.appendLine(`[DECKER EXIT] decker build exitcode: ${code}`);
    } else {
      logChannel.appendLine(`[DECKER EXIT] decker build`);
    }
  });
  localProcess.on("error", (error) => {
    logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
  });
}

async function publishProject() {
  let command = getDeckerCommand("decker");
  const installed: boolean = await checkedInstalled(command);
  if (!installed) {
    showInstallWebview();
    return;
  }
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage(
      "No workspace is open to run a decker command in."
    );
    return;
  }
  const workspaceDirecotry = workspaceFolders[0].uri.fsPath;
  const localProcess = spawn(command, ["publish"], {
    cwd: workspaceDirecotry,
    env: process.env,
  });
  localProcess.stdout.on("data", (data) => {
    stdoutChannel.append(data.toString());
  });
  localProcess.stderr.on("data", (data) => {
    stderrChannel.append(data.toString());
  });
  localProcess.on("exit", (code) => {
    vscode.window.showInformationMessage("Finished publishing project.");
    if (code) {
      logChannel.appendLine(`[DECKER EXIT] decker publish exitcode: ${code}`);
    } else {
      logChannel.appendLine(`[DECKER EXIT] decker publish`);
    }
  });
  localProcess.on("error", (error) => {
    logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
  });
}

async function crunchVideos() {
  let command = getDeckerCommand("decker");
  const installed: boolean = await checkedInstalled(command);
  if (!installed) {
    showInstallWebview();
    return;
  }
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage(
      "No workspace is open to run a decker command in."
    );
    return;
  }
  const workspaceDirecotry = workspaceFolders[0].uri.fsPath;
  const localProcess = spawn(command, ["crunch"], {
    cwd: workspaceDirecotry,
    env: process.env,
  });
  localProcess.stdout.on("data", (data) => {
    stdoutChannel.append(data.toString());
  });
  localProcess.stderr.on("data", (data) => {
    stderrChannel.append(data.toString());
  });
  localProcess.on("exit", (code) => {
    vscode.window.showInformationMessage("Finished reformatting video files.");
    if (code) {
      logChannel.appendLine(`[DECKER EXIT] decker crunch exitcode: ${code}`);
    } else {
      logChannel.appendLine(`[DECKER EXIT] decker crunch`);
    }
  });
  localProcess.on("error", (error) => {
    logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
  });
}

async function startDeckerServer() {
  let command = getDeckerCommand("decker");
  let port = getDeckerPort(8888);
  const installed: boolean = await checkedInstalled(command);
  if (!installed) {
    showInstallWebview();
    updateStatusBarItem();
    return;
  }
  if (!!deckerProcess) {
    vscode.window.showInformationMessage(
      "Decker is already running in this session."
    );
    updateStatusBarItem();
  } else {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage(
        "No workspace is open to start a decker server in."
      );
      return;
    }
    const workspaceDirecotry = workspaceFolders[0].uri.fsPath;
    let occupied: boolean = await portOccupied(port);
    while (occupied) {
      port = +port + 1;
      occupied = await portOccupied(port);
    }
    deckerPort = port;
    deckerProcess = spawn(command, ["--server", "-p", `${port}`, "-e"], {
      cwd: workspaceDirecotry,
      env: process.env,
    });
    deckerProcess.stdout.on("data", (data) => {
      stdoutChannel.append(data.toString());
    });
    deckerProcess.stderr.on("data", (data) => {
      const message = data.toString();
      stderrChannel.append(message);
      const answer = vscode.window.showErrorMessage(
        "Decker just reported an error.",
        "Show Details"
      );
    });
    deckerProcess.on("exit", (code) => {
      vscode.window.showInformationMessage("Decker Server terminated.");
      if (code) {
        logChannel.appendLine(
          `[DECKER EXIT] Server closed with exitcode: ${code}`
        );
      } else {
        logChannel.appendLine(`[DECKER EXIT] Server Closed`);
      }
      deckerProcess = null;
      updateStatusBarItem();
    });
    deckerProcess.on("error", (error) => {
      logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
      vscode.window.showInformationMessage(
        "An error just happend to the decker server process."
      );
      updateStatusBarItem();
    });
    deckerProcess.on("spawn", (event: any) => {
      vscode.window.showInformationMessage(
        `Started Decker Server in: ${workspaceDirecotry}:${port}`
      );
      updateStatusBarItem();
    });
  }
}

async function stopDeckerServer() {
  if (!!deckerProcess) {
    deckerProcess.kill();
    deckerProcess = null;
  }
  updateStatusBarItem();
}

async function portOccupied(port: number): Promise<boolean> {
  const platform = process.platform;
  let cmd: string = "";
  let args: string[] = [];
  /* Both the Powershell Command and lsof have the same behaviour: If no process uses the requested
   * port they exit with exit code 1, if they find something they print it out and exit with code 0. */
  switch (platform) {
    case "win32": //Use Windows Powershell
      cmd = "powershell.exe";
      args = [`Get-NetTCPConnection -LocalPort ${port}`];
      break;
    default: //Use lsof
      cmd = "lsof";
      args = [`-i:${port}`, "-P", "-n"];
      break;
  }
  return new Promise<boolean>((resolve, reject) => {
    let child = spawn(cmd, args);
    child.stdout.on("data", function (data: any) {
      //					stdoutChannel.appendLine(data.toString());
    });
    child.stderr.on("data", function (data: any) {
      //					stderrChannel.appendLine(data.toString());
    });
    child.on("exit", function (code: any) {
      if (code === 0) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    child.stdin.end();
  });
}

async function checkedInstalled(program: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    exists(program)
      .then((/*command*/) => {
        resolve(true);
      })
      .catch((/*error*/) => {
        resolve(false);
      });
  });
}

function getStorageDirectory(context: vscode.ExtensionContext): string {
  let storage: string | undefined = vscode.workspace
    .getConfiguration("decker")
    .get("storagePath");
  if (!storage) {
    storage = context.globalStorageUri.fsPath;
  } else {
    storage
      .replace("${HOME}", os.homedir)
      .replace("${home}", os.homedir)
      .replace(/^~/, os.homedir);
    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders[0]
    ) {
      let folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
      storage
        .replace("${workspaceFolder}", folder)
        .replace("${workspaceRoot}", folder);
    }
  }
  return storage;
}

//TODO Get this from github once migration is done
function getCurrentDeckerVersion(): string {
  return "0.11";
}

export function deactivate() {
  stopDeckerServer();
}

const configHTML: string = String.raw`<!DOCTYPE html>
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
