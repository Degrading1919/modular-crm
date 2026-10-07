import MockHostedCheckout from "../../../components/MockHostedCheckout";
export default async function TestCheckoutPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return <MockHostedCheckout reference={reference}/>;
}
