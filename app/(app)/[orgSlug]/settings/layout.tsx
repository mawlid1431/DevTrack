import { SettingsNav } from "@/components/billing/settings-nav";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="flex h-12 shrink-0 items-center border-b px-4 text-sm font-medium">
        Settings
      </header>
      {/* Phones: settings tabs scroll horizontally above the content. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <SettingsNav />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-6 sm:px-8 sm:py-8">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
