import OpsDashboard from "@/components/OpsDashboard";

export const metadata = {
  title: "Quest Room Ops",
  robots: {
    index: false,
    follow: false
  }
};

export default function OpsPage() {
  return <OpsDashboard />;
}
