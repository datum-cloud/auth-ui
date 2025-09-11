"use client";

import { sendLoginname } from "@/lib/server/loginname";
import { LoginSettings } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "./alert";
import { FormActions } from "./form-actions";
import { TextInput } from "./input";
import { Translated } from "./translated";

type Inputs = {
  loginName: string;
};

type Props = {
  loginName: string | undefined;
  requestId: string | undefined;
  loginSettings: LoginSettings | undefined;
  organization?: string;
  suffix?: string;
  submit: boolean;
  children?: ReactNode;
};

export function UsernameForm({
  loginName,
  requestId,
  organization,
  suffix,
  loginSettings,
  submit,
  children, // /
}: Props) {
  const { register, handleSubmit, formState } = useForm<Inputs>({
    mode: "onBlur",
    defaultValues: {
      loginName: loginName ? loginName : "",
    },
  });

  const router = useRouter();

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  async function submitLoginName(values: Inputs, organization?: string) {
    setLoading(true);

    const res = await sendLoginname({
      loginName: values.loginName,
      organization,
      requestId,
      suffix,
    })
      .catch(() => {
        setError("An internal error occurred");
        return;
      })
      .finally(() => {
        setLoading(false);
      });

    if (res && "redirect" in res && res.redirect) {
      return router.push(res.redirect);
    }

    if (res && "error" in res && res.error) {
      setError(res.error);
      return;
    }

    return res;
  }

  useEffect(() => {
    if (submit && loginName) {
      // When we navigate to this page, we always want to be redirected if submit is true and the parameters are valid.
      submitLoginName({ loginName }, organization);
    }
  }, []);

  let inputLabel = "Loginname";
  if (
    loginSettings?.disableLoginWithEmail &&
    loginSettings?.disableLoginWithPhone
  ) {
    inputLabel = "Username";
  } else if (loginSettings?.disableLoginWithEmail) {
    inputLabel = "Username or phone number";
  } else if (loginSettings?.disableLoginWithPhone) {
    inputLabel = "Username or email";
  }

  return (
    <form className="w-full">
      <TextInput
        type="text"
        autoComplete="username"
        {...register("loginName", { required: "This field is required" })}
        placeholder="Username"
        data-testid="username-text-input"
        suffix={suffix}
      />

      {error && (
        <div className="py-4" data-testid="error">
          <Alert>{error}</Alert>
        </div>
      )}
      <FormActions
        submitLabel={<Translated i18nKey="submit" namespace="loginname" />}
        disabled={loading || !formState.isValid}
        loading={loading}
        onSubmit={handleSubmit((e) => submitLoginName(e, organization))}
        showBackButton={false}
        submitTestId="submit-button"
      />
    </form>
  );
}
