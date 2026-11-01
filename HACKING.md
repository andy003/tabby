# Some background

Tabby is an Electron app, with the frontend written in Typescript with the help of Angular framework. It's built using Webpack.

# Getting started

First of all, clone this repository.

# Install Dependencies
- [Node.js](https://nodejs.org/en/download/) **version 15 or newer*
- [Yarn](https://yarnpkg.com/)

First, from within the `tabby` directory install the dependencies via yarn:

```
# macOS & Windows:
yarn
```

```
# Linux (Debian/Ubuntu here as an example)
sudo apt install libfontconfig-dev libsecret-1-dev libarchive-tools libnss3 libatk1.0-0 libatk-bridge2.0-0 libgdk-pixbuf2.0-0 libgtk-3-0 libgbm1 cmake
yarn
```

_⚠️Note: If you forked this repository, you may need to pull down the tags from this repository before installing node modules. `git pull --tags upstream master`_

Build Tabby:

```
yarn run build
```

Start Tabby

```
yarn start
```

For development, keep `npm run watch` running in one terminal and `npm start` in
another after the first successful build. Reload the window after renderer
changes; restart the app after main-process changes.

The workspace uses a classic menu, icon toolbar, session sidebar and terminal
tabs. **Session** creates a saved connection; double-click a connection in the
sidebar to open it, or enter `user@host:port` in **Quick connect**. The sidebar
also shows recent sessions and open tabs and can be resized by dragging its edge.

Use **New group** in the sidebar footer, or right-click the sidebar, a session or
a group and choose **New group**. An existing user group also offers **New
subgroup**. Drag a saved session onto a group to move
it; hover over a collapsed group to expand it. Dropping onto **Ungrouped** removes
the grouping. Group changes are saved automatically. While filtering sessions,
dragging displays a list of destination groups below the search results.

The UI defaults to Simplified Chinese, including the automatic language setting.
Run `npm run test:i18n` to check translated UI messages and Pug template syntax.

**Split** creates another live terminal pane. **MultiExec** broadcasts input to
all open terminals; click it again or click inside a terminal to stop. **SFTP**
and **Tunneling** operate on the focused SSH session and are disabled for other
tab types. The SFTP browser shares the session sidebar and supports real file
transfers, directory creation and file context menus. Automatic opening of the
browser can be changed in Settings > SSH.

In the file browser, single-click selects an item and double-click opens it.
Double-clicking a text file opens a local copy with its original filename in a
text editor. Choose **System text editor**, **Visual Studio Code** or a custom
application in **Settings > SSH > Remote file editor**, or use the file context
menu’s **Open with** submenu. The selection becomes the default for subsequent
opens and is saved across restarts. **Choose application** can select Code.exe
on Windows or an application bundle on macOS. The system choice uses Notepad
on Windows and the default text editor on macOS/Linux.
Editor preparation stays out of the transfer queue; explicit downloads appear
there and retain the remote filename without adding an extension.
Saving it automatically uploads the changes. The file icon, browser footer and
window status bar show whether it is pending, syncing, synced or failed. Click
the window's sync status for per-file details, the last sync time, a local copy
and a retry action. Monitoring handles editors that replace files on save and
continues when the file browser is hidden. Disconnecting stops synchronization
and keeps the local copies under the app's `remote-edits` cache directory.

Open **File transfers** on the toolbar to see the complete upload/download list
in a dock below the terminal, alongside the file browser. Drag the top divider
to resize it (or focus the divider and use the arrow keys). Hide it to reclaim
terminal space; the toolbar and status bar reopen it with its filters intact.
Directory transfers are scanned before file I/O starts and show nested paths,
queued files, progress and individual success/failure/cancellation results.
One file failing does not stop the remaining files. Search by path or filter by
result; the completed list stays available until **Clear finished** is clicked.
Each batch also reports its success, failure and cancellation totals.

The **Custom buttons** bar below the toolbar stores shortcuts across restarts.
Click **+** to add a button, or use **Tools > Custom buttons** to edit, delete
and reorder buttons. Right-click a button to edit it. A button can send text to
the focused terminal pane or run an application command. **Append Enter** runs
the text immediately; turn it off to insert text for further editing. Optional
escape handling supports `\r`, `\n`, `\t`, `\e`, `\xHH` and `\\`.
Use **View > Toggle button bar** to hide or restore the bar.

# Building an installer

To build an installer, first complete a "normal" build as described above and then run:

```
node scripts/prepackage-plugins.mjs

node scripts/build-windows.mjs
# or
node scripts/build-linux.mjs
# or
node scripts/build-macos.mjs
```

The artifacts will be produced in the `dist` folder.

# Project layout
```
tabby
├─ app                                  # Electron app, just the bare essentials
|  ├─ src                               # Electron renderer code
|  └─ main.js                           # Electron main entry point
├─ build
├─ clink                                # Clink distribution, for Windows
├─ scripts                              # Maintenance scripts
├─ tabby-community-color-schemes     # Plugin that provides color schemes
├─ tabby-core                        # Plugin that provides base UI and tab management
├─ tabby-electron                    # Plugin that provides Electron-specific functions
├─ tabby-local                       # Plugin that provides local shells and profiles
├─ tabby-plugin-manager              # Plugin that installs other plugins
├─ tabby-settings                    # Plugin that provides the settings tab
├─ tabby-terminal                    # Plugin that provides terminal tabs
└─ tabby-web                         # Plugin that provides web-specific functions
```

# Plugin layout
```
tabby-pluginname
├─ src                                  # Typescript code
|  ├─ components                        # Angular components
|  |  ├─ foo.component.ts               # Code
|  |  ├─ foo.component.scss             # Styles
|  |  └─ foo.component.pug              # Template
|  ├─ services                          # Angular services
|  |  └─ foo.service.ts
|  ├─ api.ts                            # Publicly exported API
|  └─ index.ts                          # Module entry point
├─ package.json
├─ tsconfig.json
└─ webpack.config.js
```

# Plugins

The app will load all plugins from the source checkout in the dev mode, from the user's plugins directory at all times (click `Open Plugins Directory` under `Settings` > `Plugins`) and from the directory specified by the `TABBY_PLUGINS` environment var.

Only modules whose `package.json` file contains a `tabby-plugin` keyword will be loaded.

If you're currently in your plugin's directory, start Tabby as `TABBY_PLUGINS=$(pwd) tabby --debug`

A plugin should only provide a default export, which should be a `NgModule` class (or a `NgModuleWithDependencies` where applicable). This module will be injected as a dependency to the app's root module.

```javascript
import { NgModule } from '@angular/core'

@NgModule()
export default class MyModule {
  constructor () {
    console.log('Angular engaged, cap\'n.')
  }
}
```

Plugins provide functionality by exporting singular or multi providers:


```javascript
import { NgModule, Injectable } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton } from 'tabby-core'

@Injectable()
export class MyButtonProvider extends ToolbarButtonProvider {
    provide (): ToolbarButton[] {
        return [{
            icon: 'star',
            title: 'Foobar',
            weight: 10,
            click: () => {
                alert('Woohoo!')
            }
        }]
    }
}

@NgModule({
    providers: [
        { provide: ToolbarButtonProvider, useClass: MyButtonProvider, multi: true },
    ],
})
export default class MyModule { }
```


See `tabby-core/src/api.ts`, `tabby-settings/src/api.ts`, `tabby-local/src/api.ts` and `tabby-terminal/src/api.ts` for the available extension points.

Also check out [the example plugin](https://github.com/Eugeny/tabby-clippy).

Publish your plugin on NPM with a `tabby-plugin` keyword to make it appear in the Plugin Manager.
