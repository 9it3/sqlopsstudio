/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./jobHistory';

import { OnInit, OnChanges, Component, Inject, forwardRef, ElementRef, ChangeDetectorRef, OnDestroy, ViewChild, Input, Injectable, ChangeDetectionStrategy } from '@angular/core';
import { AgentJobHistoryInfo, AgentJobInfo } from 'sqlops';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { attachListStyler } from 'vs/platform/theme/common/styler';
import { Tree } from 'vs/base/parts/tree/browser/treeImpl';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { PanelComponent } from 'sql/base/browser/ui/panel/panel.component';
import { IBootstrapService, BOOTSTRAP_SERVICE_ID } from 'sql/services/bootstrap/bootstrapService';
import { IJobManagementService, IAgentJobCacheService } from '../common/interfaces';
import { DashboardServiceInterface } from 'sql/parts/dashboard/services/dashboardServiceInterface.service';
import { AgentViewComponent } from 'sql/parts/jobManagement/agent/agentView.component';
import { JobHistoryController, JobHistoryDataSource,
	JobHistoryRenderer, JobHistoryFilter, JobHistoryModel, JobHistoryRow } from 'sql/parts/jobManagement/views/jobHistoryTree';
import { JobStepsViewComponent } from 'sql/parts/jobManagement/views/jobStepsView.component';
import { JobStepsViewRow } from './jobStepsViewTree';
import { localize } from 'vs/nls';
import { INotificationService } from 'vs/platform/notification/common/notification';
import Severity from 'vs/base/common/severity';

export const DASHBOARD_SELECTOR: string = 'jobhistory-component';

@Component({
	selector: DASHBOARD_SELECTOR,
	templateUrl: decodeURI(require.toUrl('./jobHistory.component.html')),
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class JobHistoryComponent extends Disposable implements OnInit {

	private _jobManagementService: IJobManagementService;
	private _tree: Tree;
	private _treeController: JobHistoryController;
	private _treeDataSource: JobHistoryDataSource;
	private _treeRenderer: JobHistoryRenderer;
	private _treeFilter: JobHistoryFilter;

	@ViewChild('table') private _tableContainer: ElementRef;

	@Input() public agentJobInfo: AgentJobInfo = undefined;
	@Input() public jobId: string = undefined;
	@Input() public agentJobHistories: AgentJobHistoryInfo[] = undefined;
	public agentJobHistoryInfo: AgentJobHistoryInfo = undefined;

	private _isVisible: boolean = false;
	private _stepRows: JobStepsViewRow[] = [];
	private _showSteps: boolean = false;
	private _runStatus: string = undefined;
	private _messageService: IMessageService;
	private _agentJobCacheService: IAgentJobCacheService;
	private _notificationService: INotificationService;

	constructor(
		@Inject(BOOTSTRAP_SERVICE_ID) private bootstrapService: IBootstrapService,
		@Inject(forwardRef(() => ElementRef)) el: ElementRef,
		@Inject(forwardRef(() => ChangeDetectorRef)) private _cd: ChangeDetectorRef,
		@Inject(forwardRef(() => DashboardServiceInterface)) private _dashboardService: DashboardServiceInterface,
		@Inject(forwardRef(() => AgentViewComponent)) private _agentViewComponent: AgentViewComponent
	) {
		super();
		this._treeController = new JobHistoryController();
		this._treeDataSource = new JobHistoryDataSource();
		this._treeRenderer = new JobHistoryRenderer();
		this._treeFilter =  new JobHistoryFilter();
		this._jobManagementService = bootstrapService.jobManagementService;
		this._messageService = bootstrapService.messageService;
		this._agentJobCacheService = bootstrapService.agentJobCacheService;
		this._notificationService = bootstrapService.notificationService;
	}

	ngOnInit() {
		let ownerUri: string = this._dashboardService.connectionManagementService.connectionInfo.ownerUri;
		const self = this;
		this._treeController.onClick = (tree, element, event, origin = 'mouse') => {
			const payload = { origin: origin };
			const isDoubleClick = (origin === 'mouse' && event.detail === 2);
			// Cancel Event
			const isMouseDown = event && event.browserEvent && event.browserEvent.type === 'mousedown';
			if (!isMouseDown) {
				event.preventDefault(); // we cannot preventDefault onMouseDown because this would break DND otherwise
			}
			event.stopPropagation();
			tree.setFocus(element, payload);
			if (element && isDoubleClick) {
				event.preventDefault(); // focus moves to editor, we need to prevent default
			} else {
				tree.setFocus(element, payload);
				tree.setSelection([element], payload);
				self.agentJobHistoryInfo = self._treeController.jobHistories.filter(history => history.instanceId === element.instanceID)[0];
				if (self.agentJobHistoryInfo) {
					self.agentJobHistoryInfo.runDate = self.formatTime(self.agentJobHistoryInfo.runDate);
					if (self.agentJobHistoryInfo.steps) {
						self._stepRows = self.agentJobHistoryInfo.steps.map(step => {
							let stepViewRow = new JobStepsViewRow();
							stepViewRow.message = step.message;
							stepViewRow.runStatus = JobHistoryRow.convertToStatusString(self.agentJobHistoryInfo.runStatus);
							self._runStatus = stepViewRow.runStatus;
							stepViewRow.stepName = step.stepName;
							stepViewRow.stepID = step.stepId.toString();
							return stepViewRow;
						});
					}
					this._showSteps = true;
					self._cd.detectChanges();
				}
			}
			return true;
		};
		this._tree = new Tree(this._tableContainer.nativeElement, {
			controller: this._treeController,
			dataSource: this._treeDataSource,
			filter: this._treeFilter,
			renderer: this._treeRenderer
		});
		this._register(attachListStyler(this._tree, this.bootstrapService.themeService));
		this._tree.layout(1024);
	}

	ngAfterContentChecked() {
		if (this._isVisible === false && this._tableContainer.nativeElement.offsetParent !== null) {
			this._isVisible = true;
			if (this.agentJobHistories && this.agentJobHistories.length > 0) {
				if (this._agentJobCacheService.prevJobID === this.jobId || this.agentJobHistories[0].jobId === this.jobId) {
					this.agentJobHistoryInfo = this.agentJobHistories[0];
					this.agentJobHistoryInfo.runDate = this.formatTime(this.agentJobHistories[0].runDate);
					this._treeController.jobHistories = this.agentJobHistories;
					this._agentJobCacheService.setJobHistory(this.jobId, this.agentJobHistories);
					let jobHistoryRows = this._treeController.jobHistories.map(job => this.convertToJobHistoryRow(job));
					this._treeDataSource.data = jobHistoryRows;
					this._tree.setInput(new JobHistoryModel());
					this._cd.detectChanges();
				}
			} else {
				this.loadHistory();
			}
			this._agentJobCacheService.prevJobID = this.jobId;
		} else if (this._isVisible === true && this._tableContainer.nativeElement.offsetParent === null) {
			this._isVisible = false;
		}
	}

	loadHistory() {
		const self = this;
		let ownerUri: string = this._dashboardService.connectionManagementService.connectionInfo.ownerUri;
		this._jobManagementService.getJobHistory(ownerUri, this.jobId).then((result) => {
			if (result && result.jobs) {
				self._treeController.jobHistories = result.jobs;
				self._agentJobCacheService.setJobHistory(self.jobId, result.jobs);
				let jobHistoryRows = self._treeController.jobHistories.map(job => self.convertToJobHistoryRow(job));
				self._treeDataSource.data = jobHistoryRows;
				self._tree.setInput(new JobHistoryModel());
				self.agentJobHistoryInfo =  self._treeController.jobHistories[0];
				if (this.agentJobHistoryInfo) {
					self.agentJobHistoryInfo.runDate = self.formatTime(self.agentJobHistoryInfo.runDate);
				}
				self._cd.detectChanges();
			}
		});
	}

	private toggleCollapse(): void {
		let arrow: HTMLElement = $('.resultsViewCollapsible').get(0);
		let checkbox: any = document.getElementById('accordion');
		if (arrow.className === 'resultsViewCollapsible' && checkbox.checked === false) {
			arrow.className = 'resultsViewCollapsible collapsed';
		} else if (arrow.className === 'resultsViewCollapsible collapsed' && checkbox.checked === true) {
			arrow.className = 'resultsViewCollapsible';
		}
	}

	private jobAction(action: string, jobName: string): void {
		let ownerUri: string = this._dashboardService.connectionManagementService.connectionInfo.ownerUri;
		const self = this;
		this._jobManagementService.jobAction(ownerUri, jobName, action).then(result => {
			if (result.succeeded) {
				switch (action) {
					case ('run'):
						var startMsg = localize('jobSuccessfullyStarted', 'The job was successfully started.');
						self._notificationService.notify({
							severity: Severity.Info,
							message: startMsg
						});
						break;
					case ('stop'):
						var stopMsg = localize('jobSuccessfullyStopped', 'The job was successfully stopped.');
						self._notificationService.notify({
							severity: Severity.Info,
							message: stopMsg
						});
						break;
					default:
						break;
				}
			} else {
				self._notificationService.notify({
					severity: Severity.Error,
					message: result.errorMessage
				});
			}
		});
	}

	private goToJobs(): void {
		this._isVisible = false;
		this._agentViewComponent.showHistory = false;
	}

	private convertToJobHistoryRow(historyInfo: AgentJobHistoryInfo): JobHistoryRow {
		let jobHistoryRow = new JobHistoryRow();
		jobHistoryRow.runDate = historyInfo.runDate;
		jobHistoryRow.runStatus = JobHistoryRow.convertToStatusString(historyInfo.runStatus);
		jobHistoryRow.instanceID = historyInfo.instanceId;
		return jobHistoryRow;
	}

	private formatTime(time: string): string {
		return time.replace('T', ' ');
	}

	public showSteps(): boolean {
		return this._showSteps;
	}
}

