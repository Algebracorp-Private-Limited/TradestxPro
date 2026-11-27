import { ExampleTabs } from "../_components/examples";
import { Note, PageHead } from "../_components/ui";

export const metadata = { title: "Examples" };

export default function Examples() {
  return (
    <>
      <PageHead title="Examples" lead="Each example runs the public SDK in your browser; the code beside it is what the example does." />
      <Note tone="warn">All prices on this page are synthetic (generated random walks), not market data.</Note>
      <div className="mt-4"><ExampleTabs /></div>
    </>
  );
}
