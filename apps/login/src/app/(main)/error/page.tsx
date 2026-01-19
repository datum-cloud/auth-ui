"use client";

import { Button } from "@/components/button";

const page = () => {
  return (
    <div>
      <Button
        onClick={() => {
          throw new Error("Test error");
        }}
      >
        Test
      </Button>
    </div>
  );
};

export default page;
