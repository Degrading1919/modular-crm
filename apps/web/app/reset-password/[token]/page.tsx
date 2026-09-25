import PortalPasswordSetup from "../../../components/PortalPasswordSetup";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PortalPasswordSetup token={token}/>;
}
