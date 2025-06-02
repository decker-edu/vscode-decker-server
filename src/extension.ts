import { ChildProcessWithoutNullStreams, exec, spawn } from "child_process";
import * as vscode from "vscode";
import * as open from "open";
import * as os from "os";
import * as path from "path";
import * as exists from "command-exists";

let spawnState: string | null = null;
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

  vscode.commands.registerCommand("decker-server.toggle", async () => {
    if (spawnState === "wait") {
      return;
    }
    if (deckerProcess) {
      stopDeckerServer();
    } else {
      updateStatusBarItem("wait");
      startDeckerServer();
    }
  });

  vscode.commands.registerCommand("decker-server.pdf", () => {
    runDeckerPDF();
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
    "decker-server.purge",
    (directory: vscode.Uri) => {
      purgeProject();
    }
  );

  vscode.commands.registerCommand(
    "decker-server.build",
    (directory: vscode.Uri) => {
      buildProject();
    }
  );

  vscode.commands.registerCommand(
    "decker-server.html",
    (directory: vscode.Uri) => {
      buildHTML();
    }
  );

  vscode.commands.registerCommand(
    "decker-server.decks",
    (directory: vscode.Uri) => {
      buildDecks();
    }
  );

  vscode.commands.registerCommand(
    "decker-server.pages",
    (directory: vscode.Uri) => {
      buildPages();
    }
  );

  vscode.commands.registerCommand(
    "decker-server.handouts",
    (directory: vscode.Uri) => {
      buildHandouts();
    }
  );

  vscode.commands.registerCommand(
    "decker-server.search-index",
    (directory: vscode.Uri) => {
      buildSearchIndex();
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
    vscode.l10n.t("Decker Preview"),
    vscode.ViewColumn.Two,
    { enableScripts: true }
  );
  const cssURI: vscode.Uri = vscode.Uri.file(
    path.join(extensionPath, "res", "webview.css")
  );
  const webviewURI: vscode.Uri = panel.webview.asWebviewUri(cssURI);
  panel.webview.html = pleaseWaitHTML;
  if (!deckerProcess) {
    await buildProject();
    await startDeckerServer();
    if (!deckerProcess) {
      panel.webview.html = makeErrorHTML(
        vscode.l10n.t(
          "Unable to start a decker server in the workbench directory."
        ),
        webviewURI.toString()
      );
      return;
    }
  }
  if (editor) {
    const relativePath = getDocumentHTMLPath(editor.document);
    if (relativePath) {
      const urlPath = getServerRelativePath(relativePath);
      panel.webview.html = makePreviewHTML(urlPath, webviewURI.toString());
    } else {
      panel.webview.html = makeErrorHTML(
        vscode.l10n.t("Preview was not opened in a markdown file."),
        webviewURI.toString()
      );
    }
  } else {
    panel.webview.html = makeErrorHTML(
      vscode.l10n.t("No active document."),
      webviewURI.toString()
    );
  }
}

async function displayErrorMessage(message: string) {
  if (message.startsWith("[WARNING]")) {
    return;
  }
  const answer = await vscode.window.showErrorMessage(
    vscode.l10n.t("Decker just reported an error."),
    vscode.l10n.t("Show Details")
  );
  if (answer === vscode.l10n.t("Show Details")) {
    vscode.window.showInformationMessage(message, {
      modal: true,
    });
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

function getServerRelativePath(relative: string): string {
    let config = vscode.workspace.getConfiguration("decker");
    let deckFolder: string = config.get("deck.folder") || "";
    if (deckFolder.trim() !== "" && relative.startsWith(deckFolder)) {
        relative = relative.substring(deckFolder.length);
        if (relative.startsWith("/") || relative.startsWith("\\")) {
            relative = relative.substring(1);
        }
    }
    return relative;
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
  let relativePath = getDocumentHTMLPath(editor.document);
  if (relativePath) {
    // strip deck.folder prefix from the relative path
    const urlPath = getServerRelativePath(relativePath);
    open(`http://localhost:${deckerPort}/${urlPath}`);
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
  const cssPath = path.join(extensionPath, "res", "install.css");
  const localURI = vscode.Uri.file(cssPath);
  const cssURI = panel.webview.asWebviewUri(localURI);
  panel.webview.html = getInstallHTML(cssURI.toString());
}

function createStatusBarItem(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    1
  );
  statusBarItem.command = "decker-server.toggle";
  statusBarItem.text =
    "$(info) No Decker Server running in this session. Click here to start.";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

async function updateStatusBarItem(state: string | undefined = undefined) {
  if (state && state === "wait") {
    spawnState = "wait";
    statusBarItem.text = "$(warning) Decker-Webserver: Starting ...";
  } else if (!!deckerProcess) {
    spawnState = "spawned";
    statusBarItem.text = `$(play) Decker-Webserver: http://localhost:${deckerPort}`;
  } else {
    spawnState = null;
    statusBarItem.text = "$(info) Decker-Webserver: Offline";
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
  const localProcess = spawn(command, ["clean", "-e"], {
    cwd: workspaceDirecotry,
    env: process.env,
  });
  localProcess.stdout.on("data", (data) => {
    stdoutChannel.append(data.toString());
  });
  localProcess.stderr.on("data", (data) => {
    const message = data.toString();
    stderrChannel.append(message);
    displayErrorMessage(message);
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

async function purgeProject() {
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
  const localProcess = spawn(command, ["purge", "-e"], {
    cwd: workspaceDirecotry,
    env: process.env,
  });
  localProcess.stdout.on("data", (data) => {
    stdoutChannel.append(data.toString());
  });
  localProcess.stderr.on("data", (data) => {
    const message = data.toString();
    stderrChannel.append(message);
    displayErrorMessage(message);
  });
  localProcess.on("exit", (code) => {
    vscode.window.showInformationMessage("Finished purging project.");
    if (code) {
      logChannel.appendLine(`[DECKER EXIT] decker purge exitcode: ${code}`);
    } else {
      logChannel.appendLine(`[DECKER EXIT] decker purge`);
    }
  });
  localProcess.on("error", (error) => {
    logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
  });
}

async function buildProject() {
  return new Promise<void>(async (resolve, reject) => {
    let command = getDeckerCommand("decker");
    const installed: boolean = await checkedInstalled(command);
    if (!installed) {
      showInstallWebview();
      return resolve();
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage(
        "No workspace is open to run a decker command in."
      );
      return resolve();
    }
    const workspaceDirecotry = workspaceFolders[0].uri.fsPath;
    const localProcess = spawn(command, ["-e"], {
      cwd: workspaceDirecotry,
      env: process.env,
    });
    localProcess.stdout.on("data", (data) => {
      stdoutChannel.append(data.toString());
    });
    localProcess.stderr.on("data", (data) => {
      const message = data.toString();
      stderrChannel.append(message);
      displayErrorMessage(message);
    });
    localProcess.on("exit", (code) => {
      vscode.window.showInformationMessage("Finished building project.");
      if (code) {
        logChannel.appendLine(`[DECKER EXIT] decker exitcode: ${code}`);
      } else {
        logChannel.appendLine(`[DECKER EXIT] decker build`);
      }
      resolve();
    });
    localProcess.on("error", (error) => {
      logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
      reject(error);
    });
  });
}

async function buildHTML() {
  return new Promise<void>(async (resolve, reject) => {
    let command = getDeckerCommand("decker");
    const installed: boolean = await checkedInstalled(command);
    if (!installed) {
      showInstallWebview();
      return resolve();
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage(
        "No workspace is open to run a decker command in."
      );
      return resolve();
    }
    const workspaceDirecotry = workspaceFolders[0].uri.fsPath;
    const localProcess = spawn(command, ["html", "-e"], {
      cwd: workspaceDirecotry,
      env: process.env,
    });
    localProcess.stdout.on("data", (data) => {
      stdoutChannel.append(data.toString());
    });
    localProcess.stderr.on("data", (data) => {
      const message = data.toString();
      stderrChannel.append(message);
      displayErrorMessage(message);
    });
    localProcess.on("exit", (code) => {
      vscode.window.showInformationMessage("Finished building html.");
      if (code) {
        logChannel.appendLine(`[DECKER EXIT] decker html exitcode: ${code}`);
      } else {
        logChannel.appendLine(`[DECKER EXIT] decker html`);
      }
      resolve();
    });
    localProcess.on("error", (error) => {
      logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
      reject(error);
    });
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
  const localProcess = spawn(command, ["publish", "-e"], {
    cwd: workspaceDirecotry,
    env: process.env,
  });
  localProcess.stdout.on("data", (data) => {
    stdoutChannel.append(data.toString());
  });
  localProcess.stderr.on("data", (data) => {
    const message = data.toString();
    stderrChannel.append(message);
    displayErrorMessage(message);
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
  const localProcess = spawn(command, ["crunch", "-e"], {
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

async function buildDecks() {
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
  const localProcess = spawn(command, ["decks", "-e"], {
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
    vscode.window.showInformationMessage("Finished building decks.");
    if (code) {
      logChannel.appendLine(`[DECKER EXIT] decker decks exitcode: ${code}`);
    } else {
      logChannel.appendLine(`[DECKER EXIT] decker decks`);
    }
  });
  localProcess.on("error", (error) => {
    logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
  });
}

async function buildHandouts() {
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
  const localProcess = spawn(command, ["handouts", "-e"], {
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
    vscode.window.showInformationMessage("Finished building handouts.");
    if (code) {
      logChannel.appendLine(`[DECKER EXIT] decker handouts exitcode: ${code}`);
    } else {
      logChannel.appendLine(`[DECKER EXIT] decker handouts`);
    }
  });
  localProcess.on("error", (error) => {
    logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
  });
}

async function buildPages() {
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
  const localProcess = spawn(command, ["pages", "-e"], {
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
    vscode.window.showInformationMessage("Finished building pages.");
    if (code) {
      logChannel.appendLine(`[DECKER EXIT] decker pages exitcode: ${code}`);
    } else {
      logChannel.appendLine(`[DECKER EXIT] decker pages`);
    }
  });
  localProcess.on("error", (error) => {
    logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
  });
}

async function buildSearchIndex() {
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
  const localProcess = spawn(command, ["search-index", "-e"], {
    cwd: workspaceDirecotry,
    env: process.env,
  });
  localProcess.stdout.on("data", (data) => {
    stdoutChannel.append(data.toString());
  });
  localProcess.stderr.on("data", (data) => {
    const message = data.toString();
    stderrChannel.append(message);
    displayErrorMessage(message);
  });
  localProcess.on("exit", (code) => {
    vscode.window.showInformationMessage("Finished building search-index.");
    if (code) {
      logChannel.appendLine(
        `[DECKER EXIT] decker search-index exitcode: ${code}`
      );
    } else {
      logChannel.appendLine(`[DECKER EXIT] decker search-index`);
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
      
    // Read the deck folder setting
    let config = vscode.workspace.getConfiguration("decker");
    let deckFolder: string = config.get("deck.folder") || "";
    
    let workspaceDirecotry = workspaceFolders[0].uri.fsPath;
    if (deckFolder.trim() !== "") {
      // If deckFolder is a relative path, make it relative to the workspace folder.
      workspaceDirecotry = path.isAbsolute(deckFolder) ? deckFolder : path.join(workspaceDirecotry, deckFolder);
    }
    
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
    deckerProcess.stderr.on("data", async (data) => {
      const message = data.toString();
      stderrChannel.append(message);
      displayErrorMessage(message);
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

async function runDeckerPDF() {
  const platform = process.platform;
  if (platform === "win32") {
    vscode.window.showErrorMessage("This feature is not available on Windows.");
    return;
  }
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
  const localProcess = spawn(command, ["pdf", "-j1"], {
    cwd: workspaceDirecotry,
    env: process.env,
  });
  localProcess.stdout.on("data", (data) => {
    stdoutChannel.append(data.toString());
  });
  localProcess.stderr.on("data", (data) => {
    const message = data.toString();
    stderrChannel.append(message);
    displayErrorMessage(message);
  });
  localProcess.on("exit", (code) => {
    vscode.window.showInformationMessage("Finished exporting pdfs.");
    if (code) {
      logChannel.appendLine(`[DECKER EXIT] decker pdf exitcode: ${code}`);
    } else {
      logChannel.appendLine(`[DECKER EXIT] decker pdf`);
    }
  });
  localProcess.on("error", (error) => {
    logChannel.appendLine(`[DECKER ERROR] ${error.message}`);
  });
}

//TODO Get this from github once migration is done
function getCurrentDeckerVersion(): string {
  return "0.11";
}

export function deactivate() {
  stopDeckerServer();
}

const pleaseWaitHTML: string = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Please Wait</title>
</head>
<body>
    <h1>Decker is building your project</h1>
	<p>Please wait until the server is ready.</p>
</body>
</html>`;

function getInstallHTML(cssURI: string) {
  const PATH: string | undefined = process.env.PATH || process.env.Path;
  const platform = process.platform;
  console.log(platform);
  let pathString;
  if (platform === "win32") {
    pathString = PATH?.replace(/;/g, "\n");
  } else {
    pathString = PATH?.replace(/:/g, "\n");
  }
  const config = vscode.workspace.getConfiguration("decker");
  return String.raw`<!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Install Decker</title>
      <link rel="stylesheet" href="${cssURI}">
  </head>
  <body>
    <section>
      <h1>Install decker</h1>
      <div>
        <p>We could not find the program configured to be executed as <code>decker</code> on your system.</p>
        <p>You have configrued <code>decker</code> to be run as the program:</p>
        <p>
          <code>
            ${config.get("executable.command")}
          </code>
        </p>
        <p>You may change the program being executed as <code>decker</code> in the <code>Decker Server</code> extension's settings. You can find these settings by pressing <code>CTRL + ,</code> or under <code>File</code>, <code>Preferences</code>, <code>Settings</code>.</p>
      </div>
    </section>
    <section>
      <h2>Please check your PATH</h2>
      <div>
        <p>The configured program can not be found inside a directory listed in your <code>PATH</code> environment variable.</p>
        <p>The environment variable <code>PATH</code> or <code>Path</code> (on Windows) tells your system where to look for other programs.</p>
        <p>If you have already downloaded and installed <code>decker</code>, please check if the program is in a directory in this list.</p>
        <p>If it is not, please add the installation directory of <code>decker</code> to this list or move the executable into a directory in this list.</p>
        <p>Guidelines on how to change your <code>PATH</code> depend on your operating system.</p>
      </div>
      <div>
      <h3>Your PATH</h3>
      <p>Your <code>PATH</code> is a list of directories, seperated by <code>:</code> or <code>;</code>. These are the contents of this environment variable:</p>
      <p>
        <pre><code>${pathString}</pre></code></p>
      </div>
    </section>
    <section>
      <h1>Download Decker</h1>
      <div>
        <p>You can download <code>decker</code> from one of the following locations:</p>
        <a class="decker-link" href="https://decker.cs.tu-dortmund.de/">TU Dortmund</a>
        <a class="decker-link" href="https://elearning.uni-wuerzburg.de/decker/">Universität Würzburg</a>
        <a class="decker-link" href="https://github.com/decker-edu/decker/releases/">GitHub</a>
      </div>
    </section>
  </body>
  </html>`;
}
