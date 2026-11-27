// Angular integration (reference component; not built in this repository's CI — see README).
import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild } from "@angular/core";
import { createChart, type ChartApi, type CandlestickData } from "@tradestxpro/xchart";

@Component({
  selector: "app-xchart",
  standalone: true,
  template: `<div #host style="height: 420px"></div>`,
})
export class XChartComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) data!: CandlestickData[];
  @ViewChild("host", { static: true }) host!: ElementRef<HTMLDivElement>;
  private chart: ChartApi | null = null;

  ngAfterViewInit() {
    // Charts need the DOM: with Angular SSR, guard with isPlatformBrowser(PLATFORM_ID).
    this.chart = createChart(this.host.nativeElement, { theme: "dark" });
    this.chart.addCandlestickSeries().setData(this.data);
  }

  ngOnDestroy() {
    this.chart?.remove();
    this.chart = null;
  }
}
