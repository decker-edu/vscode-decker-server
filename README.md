# Decker Server Extension

The Decker Server Extension allows you to start and stop a decker server inside your workspace location as well as offers configuration options where to find the decker executable and whether or not you want the server to automatically start when a decker workspace is opened.

## Features

Adds Start and Stop Decker Server to the Command Palette.

Adds "Open Slides in Browser" as a context menu entry.

Automatically starts the decker server in a decker workspace if installed.

Offers advice about where to obtain a decker executable from.

## Requirements

A decker executable, preferrably installed and on your PATH. A custom path to the executable can be supplied.

## Extension Settings

This extension contributes the following settings:

* `decker.executable.command`: Configure the path or command used to start a decker server.
* `decker.server.autostart`: Configure whether to automatically start a decker server in your workspace.
* `decker.server.port`: Configure the default port from which to start looking for a free port.

## Known Issues

The webview advice about installing a decker server is functional but looks ugly.

## Release Notes

### 0.1.6

Improved information given to the user when the program decker can not be found.

### 0.1.4

Suppress error message that starts with WARNING

### 0.1.3

Added all decker targets to the context menu.

### 0.1.2

Added `decker pdf` as a context menu option.

### 0.1.1

Improved UX and fixed some long standing bugs with the server status icon not updating correctly. Also improved error reporting.

### 0.0.8 / 0.0.9

Multiple decker servers can now be started across multiple VSCode Windows.

### 0.0.7

Initial release.
