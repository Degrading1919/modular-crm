import PortalApp from "../../../components/PortalApp";

export default async function PortalPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section = [] } = await params;
  return <PortalApp section={section} />;
}
