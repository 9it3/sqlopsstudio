/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!sql/parts/grid/views/query/chartViewer';

import {
	Component, Inject, ViewContainerRef, forwardRef, OnInit,
	ComponentFactoryResolver, ViewChild, OnDestroy, Input, ElementRef, ChangeDetectorRef
} from '@angular/core';
import { NgGridItemConfig } from 'angular2-grid';

import { Taskbar } from 'sql/base/browser/ui/taskbar/taskbar';
import { Checkbox } from 'sql/base/browser/ui/checkbox/checkbox';
import { ComponentHostDirective } from 'sql/parts/dashboard/common/componentHost.directive';
import { IGridDataSet } from 'sql/parts/grid/common/interfaces';
import { SelectBox } from 'sql/base/browser/ui/selectBox/selectBox';
import { IBootstrapService, BOOTSTRAP_SERVICE_ID } from 'sql/services/bootstrap/bootstrapService';
import { IInsightData, IInsightsView, IInsightsConfig } from 'sql/parts/dashboard/widgets/insights/interfaces';
import { Extensions, IInsightRegistry } from 'sql/platform/dashboard/common/insightRegistry';
import { QueryEditor } from 'sql/parts/query/editor/queryEditor';
import { DataType, ILineConfig } from 'sql/parts/dashboard/widgets/insights/views/charts/types/lineChart.component';
import * as PathUtilities from 'sql/common/pathUtilities';
import { IChartViewActionContext, CopyAction, CreateInsightAction, SaveImageAction } from 'sql/parts/grid/views/query/chartViewerActions';
import * as WorkbenchUtils from 'sql/workbench/common/sqlWorkbenchUtils';
import * as Constants from 'sql/parts/query/common/constants';

/* Insights */
import {
	ChartInsight, DataDirection, LegendPosition
} from 'sql/parts/dashboard/widgets/insights/views/charts/chartInsight.component';

import { IDisposable } from 'vs/base/common/lifecycle';
import { attachSelectBoxStyler } from 'vs/platform/theme/common/styler';
import Severity from 'vs/base/common/severity';
import URI from 'vs/base/common/uri';
import * as nls from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { mixin } from 'vs/base/common/objects';
import * as paths from 'vs/base/common/paths';
import * as pfs from 'vs/base/node/pfs';

const insightRegistry = Registry.as<IInsightRegistry>(Extensions.InsightContribution);

@Component({
	selector: 'chart-viewer',
	templateUrl: decodeURI(require.toUrl('sql/parts/grid/views/query/chartViewer.component.html'))
})
export class ChartViewerComponent implements OnInit, OnDestroy, IChartViewActionContext {
	public legendOptions: string[];
	private chartTypesSelectBox: SelectBox;
	private legendSelectBox: SelectBox;
	private labelFirstColumnCheckBox: Checkbox;
	private columnsAsLabelsCheckBox: Checkbox;

	/* UI */
	/* tslint:disable:no-unused-variable */
	private chartTypeLabel: string = nls.localize('chartTypeLabel', 'Chart Type');
	private dataDirectionLabel: string = nls.localize('dataDirectionLabel', 'Data Direction');
	private verticalLabel: string = nls.localize('verticalLabel', 'Vertical');
	private horizontalLabel: string = nls.localize('horizontalLabel', 'Horizontal');
	private dataTypeLabel: string = nls.localize('dataTypeLabel', 'Data Type');
	private numberLabel: string = nls.localize('numberLabel', 'Number');
	private pointLabel: string = nls.localize('pointLabel', 'Point');
	private labelFirstColumnLabel: string = nls.localize('labelFirstColumnLabel', 'Use First Column as row label?');
	private columnsAsLabelsLabel: string = nls.localize('columnsAsLabelsLabel', 'Use Column names as labels?');
	private legendLabel: string = nls.localize('legendLabel', 'Legend Position');
	private chartNotFoundError: string = nls.localize('chartNotFound', 'Could not find chart to save');
	/* tslint:enable:no-unused-variable */

	private _actionBar: Taskbar;
	private _createInsightAction: CreateInsightAction;
	private _copyAction: CopyAction;
	private _saveAction: SaveImageAction;
	private _chartConfig: ILineConfig;
	private _disposables: Array<IDisposable> = [];
	private _dataSet: IGridDataSet;
	private _executeResult: IInsightData;
	private _chartComponent: ChartInsight;

	@ViewChild(ComponentHostDirective) private componentHost: ComponentHostDirective;
	@ViewChild('taskbarContainer', { read: ElementRef }) private taskbarContainer;
	@ViewChild('chartTypesContainer', { read: ElementRef }) private chartTypesElement;
	@ViewChild('legendContainer', { read: ElementRef }) private legendElement;
	@ViewChild('labelFirstColumnContainer', { read: ElementRef }) private labelFirstColumnElement;
	@ViewChild('columnsAsLabelsContainer', { read: ElementRef }) private columnsAsLabelsElement;

	constructor(
		@Inject(forwardRef(() => ComponentFactoryResolver)) private _componentFactoryResolver: ComponentFactoryResolver,
		@Inject(forwardRef(() => ViewContainerRef)) private _viewContainerRef: ViewContainerRef,
		@Inject(BOOTSTRAP_SERVICE_ID) private _bootstrapService: IBootstrapService,
		@Inject(forwardRef(() => ChangeDetectorRef)) private _cd: ChangeDetectorRef
	) {
	}

	ngOnInit() {
		this._chartConfig = <ILineConfig>{
			dataDirection: 'vertical',
			dataType: 'number',
			legendPosition: 'none',
			labelFirstColumn: false
		};
		this.legendOptions = Object.values(LegendPosition);
		this.initializeUI();
	}

	private initializeUI() {
		// Initialize the taskbar
		this._initActionBar();

		// Init chart type dropdown
		this.chartTypesSelectBox = new SelectBox(insightRegistry.getAllIds(), this.getDefaultChartType(), this._bootstrapService.contextViewService);
		this.chartTypesSelectBox.render(this.chartTypesElement.nativeElement);
		this.chartTypesSelectBox.onDidSelect(selected => this.onChartChanged());
		this._disposables.push(attachSelectBoxStyler(this.chartTypesSelectBox, this._bootstrapService.themeService));

		// Init label first column checkbox
		// Note: must use 'self' for callback
		this.labelFirstColumnCheckBox = new Checkbox(this.labelFirstColumnElement.nativeElement, {
			label: this.labelFirstColumnLabel,
			onChange: () => this.onLabelFirstColumnChanged()
		});

		// Init label first column checkbox
		// Note: must use 'self' for callback
		this.columnsAsLabelsCheckBox = new Checkbox(this.columnsAsLabelsElement.nativeElement, {
			label: this.columnsAsLabelsLabel,
			onChange: () => this.columnsAsLabelsChanged()
		});

		// Init legend dropdown
		this.legendSelectBox = new SelectBox(this.legendOptions, this._chartConfig.legendPosition, this._bootstrapService.contextViewService);
		this.legendSelectBox.render(this.legendElement.nativeElement);
		this.legendSelectBox.onDidSelect(selected => this.onLegendChanged());
		this._disposables.push(attachSelectBoxStyler(this.legendSelectBox, this._bootstrapService.themeService));
	}

	private getDefaultChartType(): string {
		let defaultChartType = Constants.chartTypeHorizontalBar;
		if (this._bootstrapService.configurationService) {
			let chartSettings = WorkbenchUtils.getSqlConfigSection(this._bootstrapService.configurationService, 'chart');
			// Only use the value if it's a known chart type. Ideally could query this dynamically but can't figure out how
			if (chartSettings && Constants.allChartTypes.indexOf(chartSettings[Constants.defaultChartType]) > -1) {
				defaultChartType = chartSettings[Constants.defaultChartType];
			}
		}
		return defaultChartType;
	}

	private _initActionBar() {
		this._createInsightAction = this._bootstrapService.instantiationService.createInstance(CreateInsightAction);
		this._copyAction = this._bootstrapService.instantiationService.createInstance(CopyAction);
		this._saveAction = this._bootstrapService.instantiationService.createInstance(SaveImageAction);

		let taskbar = <HTMLElement>this.taskbarContainer.nativeElement;
		this._actionBar = new Taskbar(taskbar, this._bootstrapService.contextMenuService);
		this._actionBar.context = this;
		this._actionBar.setContent([
			{ action: this._createInsightAction },
			{ action: this._copyAction },
			{ action: this._saveAction }
		]);
	}


	public onChartChanged(): void {
		if ([Constants.chartTypeScatter, Constants.chartTypeTimeSeries].some(item => item === this.chartTypesSelectBox.value)) {
			this.dataType = DataType.Point;
			this.dataDirection = DataDirection.Horizontal;
		}
		this.initChart();
	}

	public onLabelFirstColumnChanged(): void {
		this._chartConfig.labelFirstColumn = this.labelFirstColumnCheckBox.checked;
		this.initChart();
	}

	public columnsAsLabelsChanged(): void {
		this._chartConfig.columnsAsLabels = this.columnsAsLabelsCheckBox.checked;
		this.initChart();
	}

	public onLegendChanged(): void {
		this._chartConfig.legendPosition = <LegendPosition>this.legendSelectBox.value;
		this.initChart();
	}

	public set dataType(type: DataType) {
		this._chartConfig.dataType = type;
		// Requires full chart refresh
		this.initChart();
	}

	public set dataDirection(direction: DataDirection) {
		this._chartConfig.dataDirection = direction;
		// Requires full chart refresh
		this.initChart();
	}

	public copyChart(): void {
		let data = this._chartComponent.getCanvasData();
		if (!data) {
			this.showError(this.chartNotFoundError);
			return;
		}

		this._bootstrapService.clipboardService.writeImageDataUrl(data);
	}

	public saveChart(): void {
		this.promptForFilepath().then(filePath => {
			let data = this._chartComponent.getCanvasData();
			if (!data) {
				this.showError(this.chartNotFoundError);
				return;
			}
			if (filePath) {
				let buffer = this.decodeBase64Image(data);
				pfs.writeFile(filePath, buffer).then(undefined, (err) => {
					if (err) {
						this.showError(err.message);
					} else {
						let fileUri = URI.from({ scheme: PathUtilities.FILE_SCHEMA, path: filePath });
						this._bootstrapService.windowsService.openExternal(fileUri.toString());
						this._bootstrapService.notificationService.notify({
							severity: Severity.Error,
							message: nls.localize('chartSaved', 'Saved Chart to path: {0}', filePath)
						});
					}
				});
			}
		});
	}

	private promptForFilepath(): Thenable<string> {
		let filepathPlaceHolder = PathUtilities.resolveCurrentDirectory(this.getActiveUriString(), PathUtilities.getRootPath(this._bootstrapService.workspaceContextService));
		filepathPlaceHolder = paths.join(filepathPlaceHolder, 'chart.png');
		return this._bootstrapService.windowService.showSaveDialog({
			title: nls.localize('chartViewer.saveAsFileTitle', 'Choose Results File'),
			defaultPath: paths.normalize(filepathPlaceHolder, true)
		});
	}

	private decodeBase64Image(data: string): Buffer {
		let matches = data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
		return new Buffer(matches[2], 'base64');
	}

	public createInsight(): void {
		let uriString: string = this.getActiveUriString();
		if (!uriString) {
			this.showError(nls.localize('createInsightNoEditor', 'Cannot create insight as the active editor is not a SQL Editor'));
			return;
		}

		let uri: URI = URI.parse(uriString);
		let dataService = this._bootstrapService.queryModelService.getDataService(uriString);
		if (!dataService) {
			this.showError(nls.localize('createInsightNoDataService', 'Cannot create insight, backing data model not found'));
			return;
		}
		let queryFile: string = uri.fsPath;
		let query: string = undefined;
		let type = {};
		type[this.chartTypesSelectBox.value] = this._chartConfig;
		// create JSON
		let config: IInsightsConfig = {
			type,
			query,
			queryFile
		};

		let widgetConfig = {
			name: nls.localize('myWidgetName', 'My-Widget'),
			gridItemConfig: this.getGridItemConfig(),
			widget: {
				'insights-widget': config
			}
		};

		// open in new window as untitled JSON file
		dataService.openLink(JSON.stringify(widgetConfig), 'Insight', 'json');
	}

	private showError(errorMsg: string) {
		this._bootstrapService.notificationService.notify({
			severity: Severity.Error,
			message: errorMsg
		});
	}

	private getGridItemConfig(): NgGridItemConfig {
		let config: NgGridItemConfig = {
			sizex: 2,
			sizey: 1
		};
		return config;
	}

	private getActiveUriString(): string {
		let editorService = this._bootstrapService.editorService;
		let editor = editorService.getActiveEditor();
		if (editor && editor instanceof QueryEditor) {
			let queryEditor: QueryEditor = editor;
			return queryEditor.uri;
		}
		return undefined;
	}

	private get showDataDirection(): boolean {
		return ['pie', 'horizontalBar', 'bar', 'doughnut'].some(item => item === this.chartTypesSelectBox.value) || (this.chartTypesSelectBox.value === 'line' && this.dataType === 'number');
	}

	private get showLabelFirstColumn(): boolean {
		return this.dataDirection === 'horizontal' && this.dataType !== 'point';
	}

	private get showColumnsAsLabels(): boolean {
		return this.dataDirection === 'vertical' && this.dataType !== 'point';
	}

	private get showDataType(): boolean {
		return this.chartTypesSelectBox.value === 'line';
	}

	public get dataDirection(): DataDirection {
		return this._chartConfig.dataDirection;
	}

	public get dataType(): DataType {
		return this._chartConfig.dataType;
	}

	@Input() set dataSet(dataSet: IGridDataSet) {
		// Setup the execute result
		this._dataSet = dataSet;
		this._executeResult = <IInsightData>{};
		this._executeResult.columns = dataSet.columnDefinitions.map(def => def.name);
		this._executeResult.rows = dataSet.dataRows.getRange(0, dataSet.dataRows.getLength()).map(gridRow => {
			return gridRow.values.map(cell => cell.displayValue);
		});
		this.initChart();
	}

	public initChart() {
		this._cd.detectChanges();
		if (this._executeResult) {
			// Reinitialize the chart component
			let componentFactory = this._componentFactoryResolver.resolveComponentFactory<IInsightsView>(insightRegistry.getCtorFromId(this.chartTypesSelectBox.value));
			this.componentHost.viewContainerRef.clear();
			let componentRef = this.componentHost.viewContainerRef.createComponent(componentFactory);
			this._chartComponent = <ChartInsight>componentRef.instance;
			this._chartComponent.setConfig(this._chartConfig);
			this._chartComponent.data = this._executeResult;
			this._chartComponent.options = mixin(this._chartComponent.options, { animation: { duration: 0 } });
			if (this._chartComponent.init) {
				this._chartComponent.init();
			}
		}
	}

	ngOnDestroy() {
		this._disposables.forEach(i => i.dispose());
	}
}