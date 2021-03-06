/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import nls = require('vs/nls');
import { Action } from 'vs/base/common/actions';
import { TPromise } from 'vs/base/common/winjs.base';
import Event, { Emitter } from 'vs/base/common/event';
import { IQuickOpenService } from 'vs/platform/quickOpen/common/quickOpen';
import { IConnectionProfile } from 'sql/parts/connection/common/interfaces';
import { IConnectionManagementService } from 'sql/parts/connection/common/connectionManagement';
import { INotificationService, INotificationActions } from 'vs/platform/notification/common/notification';
import Severity from 'vs/base/common/severity';

/**
 * Workbench action to clear the recent connnections list
 */
export class ClearRecentConnectionsAction extends Action {

		public static ID = 'clearRecentConnectionsAction';
		public static LABEL = nls.localize('ClearRecentlyUsedLabel', 'Clear Recent Connections List');

		constructor(
			id: string,
			label: string,
			@IConnectionManagementService private _connectionManagementService: IConnectionManagementService,
			@INotificationService private _notificationService: INotificationService,
			@IQuickOpenService private _quickOpenService: IQuickOpenService
		) {
			super(id, label);
			this.enabled = true;
		}

		public run(): TPromise<void> {
			let self = this;
			return self.promptToClearRecentConnectionsList().then(result => {
				if (result) {
					self._connectionManagementService.clearRecentConnectionsList();

					const actions: INotificationActions = { primary: [ ] };
					self._notificationService.notify({
						severity: Severity.Info,
						message: nls.localize('ClearedRecentConnections', 'Recent connections list cleared'),
						actions
					});
				}
			});
		}

		private promptToClearRecentConnectionsList(): TPromise<boolean> {
			const self = this;
			return new TPromise<boolean>((resolve, reject) => {
				let choices: { key, value }[] = [
					{ key: nls.localize('connectionAction.yes', 'Yes'), value: true },
					{ key: nls.localize('connectionAction.no', 'No'), value: false }
				];

				self._quickOpenService.pick(choices.map(x => x.key), { placeHolder: nls.localize('ClearRecentlyUsedLabel', 'Clear Recent Connections List'), ignoreFocusLost: true }).then((choice) => {
					let confirm = choices.find(x => x.key === choice);
					resolve(confirm && confirm.value);
				});
			});
		}
	}

/**
 * Action to delete one recently used connection from the MRU
 */
export class ClearSingleRecentConnectionAction extends Action {

	public static ID = 'clearSingleRecentConnectionAction';
	public static LABEL = nls.localize('delete', 'Delete');
	private _onRecentConnectionRemoved = new Emitter<void>();
	public onRecentConnectionRemoved: Event<void> = this._onRecentConnectionRemoved.event;

	constructor(
		id: string,
		label: string,
		private _connectionProfile: IConnectionProfile,
		@IConnectionManagementService private _connectionManagementService: IConnectionManagementService,
	) {
		super(id, label);
		this.enabled = true;
	}

	public run(): TPromise<void> {
		return new TPromise<void>((resolve, reject) => {
			resolve(this._connectionManagementService.clearRecentConnection(this._connectionProfile));
			this._onRecentConnectionRemoved.fire();
		});
	}
}