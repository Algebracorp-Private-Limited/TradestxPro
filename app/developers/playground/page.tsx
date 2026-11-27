import { Playground } from "../_components/playground";
import { Note, PageHead } from "../_components/ui";

export const metadata = { title: "Playground" };

export default function PlaygroundPage() {
  return (
    <>
      <PageHead title="Playground" lead="Configure a chart with controls, or edit its layout JSON and load it back. The generated code mirrors your configuration." />
      <Note>The playground does not run code you type: changes go through validated SDK calls only. Data is synthetic.</Note>
      <div className="mt-4"><Playground /></div>
    </>
  );
}
