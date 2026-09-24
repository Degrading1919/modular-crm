import BusinessApp from "../../../components/BusinessApp";

export default async function BusinessPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section = [] } = await params;
  return <BusinessApp section={section} />;
}
