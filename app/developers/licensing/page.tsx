import { Note, PageHead, Section, Table } from "../_components/ui";

export const metadata = { title: "Licensing" };

export default function Licensing() {
  return (
    <>
      <PageHead title="Licensing" lead="How XChart will be licensed, and what is not yet decided." />
      <Note tone="warn">
        Draft for discussion. No commercial or enterprise licence terms are published and no subscription can be purchased. Evaluation copies are
        provided under the proprietary notice in the package&apos;s LICENSE file. Contact Algebracorp Private Limited for an evaluation.
      </Note>
      <Section title="Planned licence types (not yet offered)">
        <Table head={["Type", "Intended for", "Status"]} rows={[
          ["Evaluation", "Trying the SDK in non-production projects", "Available by agreement"],
          ["Commercial", "Production use in your own products", "Terms not published"],
          ["Enterprise", "Large deployments, source access, support SLAs", "Terms not published"],
        ]} />
      </Section>
      <Section title="Software vs market data">
        <p className="text-sm leading-6 text-muted">
          An XChart licence is a software licence. It never includes the right to receive, display or redistribute exchange or vendor market data. Data
          rights come from your data provider and the exchanges, under their own terms and fees.
        </p>
      </Section>
    </>
  );
}
