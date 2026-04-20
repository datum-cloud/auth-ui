import { Alert, AlertType } from "@/components/alert";

export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const title = searchParams.title ?? "Something went wrong";
  const message =
    searchParams.error ?? "An unexpected error occurred. Please try again.";

  return (
    <>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="pt-6">
        <Alert type={AlertType.ALERT}>{message}</Alert>
      </div>
    </>
  );
}
