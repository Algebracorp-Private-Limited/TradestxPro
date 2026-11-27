// Vue 3 integration: create the chart in onMounted, remove it in onBeforeUnmount.
import { createApp, defineComponent, h, onBeforeUnmount, onMounted, ref } from "vue";
import { createChart } from "@tradestxpro/xchart";

const XChart = defineComponent({
  props: { data: { type: Array, required: true } },
  setup(props) {
    const el = ref(null);
    let chart = null;
    onMounted(() => {
      chart = createChart(el.value, { theme: "dark" });
      chart.addCandlestickSeries().setData(props.data);
      chart.addIndicator("macd");
      window.ready = true;
    });
    onBeforeUnmount(() => chart?.remove());
    return () => h("div", { ref: el, style: "height: 420px" });
  },
});

const data = Array.from({ length: 250 }, (_, i) => {
  const c = 50 + Math.cos(i / 12) * 5 + i * 0.03;
  return { time: 1704067200 + i * 86400, open: c - 0.3, high: c + 0.8, low: c - 0.9, close: c + (i % 3 ? 0.2 : -0.2) };
});
createApp({ render: () => h(XChart, { data }) }).mount("#app");
