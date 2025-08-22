import { Navbar } from "@/modules/home/ui/components/navbar";

interface Props {
  children: React.ReactNode;
}

const Layout = ({ children }: Props) => {
  return (
    <main className="flex flex-col min-h-screen max-h-screen">
      <Navbar />
      <div
        className="absolute inset-0 -z-10 h-full w-full 
        bg-[radial-gradient(circle,_#dadde2_1px,_transparent_1px)] 
        dark:bg-[radial-gradient(circle,_#393e4a_1px,_transparent_1px)] 
        [background-size:20px_20px]"
      />
      <div className="flex-1 flex flex-col px-4 pb-4">{children}</div>
    </main>
  );
};

export default Layout;
