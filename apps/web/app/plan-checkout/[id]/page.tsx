import { MockPlanCheckout } from "../../../components/PlanBilling";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <MockPlanCheckout id={(await params).id}/>; }
