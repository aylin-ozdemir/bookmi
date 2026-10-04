import EventRoom from "@/components/EventRoom";

export default async function EventPage(props: PageProps<"/e/[slug]">) {
  const { slug } = await props.params;
  return <EventRoom slug={slug} />;
}
