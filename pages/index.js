
import dynamic from "next/dynamic";
import Head from "next/head";

const Dashboard = dynamic(() => import("../components/Dashboard"), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>Social Media Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Dashboard />
    </>
  );
}
