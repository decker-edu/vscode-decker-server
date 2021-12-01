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

## Known Issues

The webview advice about installing a decker server is functional but looks ugly.

## Release Notes

### 0.0.4

Initial release.
