import { ApiBrowser } from "../_components/api-browser";
import { PageHead } from "../_components/ui";
import api from "./api.json";

export const metadata = { title: "API reference" };

export default function ApiReference() {
  return (
    <>
      <PageHead
        title="API reference"
        lead={`All ${api.count} public exports of @tradestxpro/xchart ${api.version}, generated from the SDK's TypeScript declarations (${api.generatedFrom}). Signatures are exact; descriptions come from the source documentation.`}
      />
      <ApiBrowser items={api.items} />
    </>
  );
}
