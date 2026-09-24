import FieldApp from "../../../components/FieldApp";

export default async function FieldPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section = [] } = await params;
  return <FieldApp section={section} />;
}
