import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { isValidURL } from '@app/utils/urlValidationHelper';
import { ArrowDownOnSquareIcon, BeakerIcon } from '@heroicons/react/24/outline';
import type { BookLoreSettings } from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings', {
  bookloreSettings: 'BookLore Settings',
  bookloreSettingsDescription:
    'Configure the connection to your BookLore server. BookLore provides both the availability data and the acquisition backend for book and audiobook requests.',
  bookloreEnabled: 'Enable BookLore',
  bookloreHostname: 'Hostname or IP Address',
  bookloreHostnameTip:
    'Point this at the BookLore container address directly. Routing through a public hostname puts forward-auth in front of the API and breaks the JWT flow.',
  booklorePort: 'Port',
  bookloreSsl: 'Use SSL',
  bookloreBaseUrl: 'URL Base',
  bookloreUsername: 'Username',
  bookloreUsernameTip:
    'This account must be a BookLore admin, as every wanted-books endpoint requires admin.',
  booklorePassword: 'Password',
  bookloreExternalUrl: 'External URL',
  bookloreDefaultFormat: 'Default Format',
  bookloreFormatEbook: 'Ebook',
  bookloreFormatAudiobook: 'Audiobook',
  bookloreFormatAny: 'Either',
  bookloreAutoSearch: 'Enable Automatic Search',
  bookloreAutoSearchTip:
    'Ask BookLore to run its indexer search across the wanted list when it syncs.',
  bookloreSettingsSuccess: 'BookLore settings saved successfully!',
  bookloreSettingsFailure:
    'Something went wrong while saving BookLore settings.',
  bookloreTestSuccess: 'BookLore connection established successfully!',
  bookloreTestFailure: 'Failed to connect to BookLore.',
  bookloreTestConnected:
    'Connected. {count, plural, one {# book} other {# books}} on the wanted list.',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  validationUsernameRequired: 'You must provide a username',
  validationPasswordRequired: 'You must provide a password',
  validationUrl: 'You must provide a valid URL',
  validationUrlTrailingSlash: 'URL must not end in a trailing slash',
  validationUrlBaseLeadingSlash: 'URL base must have a leading slash',
  validationUrlBaseTrailingSlash: 'URL base must not end in a trailing slash',
});

interface BookLoreTestResponse {
  connected: boolean;
  wantedCount: number;
  isAdmin: boolean;
}

const SettingsBookLore = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const initialLoad = useRef(false);
  const autoTested = useRef(false);
  const [isValidated, setIsValidated] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResponse, setTestResponse] = useState<BookLoreTestResponse | null>(
    null
  );
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<BookLoreSettings>('/api/v1/settings/booklore');

  const BookLoreSettingsSchema = Yup.object().shape({
    hostname: Yup.string().when('enabled', {
      is: true,
      then: (schema) =>
        schema
          .nullable()
          .required(intl.formatMessage(messages.validationHostnameRequired)),
      otherwise: (schema) => schema.nullable(),
    }),
    port: Yup.number().when('enabled', {
      is: true,
      then: (schema) =>
        schema
          .typeError(intl.formatMessage(messages.validationPortRequired))
          .nullable()
          .required(intl.formatMessage(messages.validationPortRequired)),
      otherwise: (schema) =>
        schema
          .typeError(intl.formatMessage(messages.validationPortRequired))
          .nullable(),
    }),
    username: Yup.string().when('enabled', {
      is: true,
      then: (schema) =>
        schema
          .nullable()
          .required(intl.formatMessage(messages.validationUsernameRequired)),
      otherwise: (schema) => schema.nullable(),
    }),
    password: Yup.string().when('enabled', {
      is: true,
      then: (schema) =>
        schema
          .nullable()
          .required(intl.formatMessage(messages.validationPasswordRequired)),
      otherwise: (schema) => schema.nullable(),
    }),
    baseUrl: Yup.string()
      .nullable()
      .test(
        'leading-slash',
        intl.formatMessage(messages.validationUrlBaseLeadingSlash),
        (value) => !value || value.startsWith('/')
      )
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationUrlBaseTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
    externalUrl: Yup.string()
      .nullable()
      .test('valid-url', intl.formatMessage(messages.validationUrl), isValidURL)
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationUrlTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
  });

  const testConnection = useCallback(
    async ({
      hostname,
      port,
      useSsl = false,
      baseUrl,
      username,
      password,
    }: {
      hostname: string;
      port: number;
      useSsl?: boolean;
      baseUrl?: string;
      username: string;
      password: string;
    }) => {
      setIsTesting(true);
      try {
        const response = await axios.post<BookLoreTestResponse>(
          '/api/v1/settings/booklore/test',
          {
            hostname,
            port: Number(port),
            useSsl,
            baseUrl,
            username,
            password,
          }
        );

        setIsValidated(true);
        setTestResponse(response.data);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.bookloreTestSuccess), {
            appearance: 'success',
            autoDismiss: true,
          });
        }
      } catch (e) {
        setIsValidated(false);
        setTestResponse(null);
        if (initialLoad.current) {
          addToast(
            e?.response?.data?.message ??
              intl.formatMessage(messages.bookloreTestFailure),
            {
              appearance: 'error',
              autoDismiss: true,
            }
          );
        }
      } finally {
        setIsTesting(false);
        initialLoad.current = true;
      }
    },
    [addToast, intl]
  );

  useEffect(() => {
    if (autoTested.current || !data?.enabled || !data.hostname) {
      return;
    }

    autoTested.current = true;
    testConnection({
      hostname: data.hostname,
      port: data.port,
      useSsl: data.useSsl,
      baseUrl: data.baseUrl,
      username: data.username,
      password: data.password,
    });
  }, [data, testConnection]);

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.bookloreSettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.bookloreSettingsDescription)}
        </p>
      </div>
      <Formik
        initialValues={{
          enabled: data?.enabled ?? false,
          hostname: data?.hostname ?? '',
          port: data?.port ?? 6060,
          useSsl: data?.useSsl ?? false,
          baseUrl: data?.baseUrl ?? '',
          username: data?.username ?? '',
          password: data?.password ?? '',
          externalUrl: data?.externalUrl ?? '',
          defaultFormat: data?.defaultFormat ?? 'EBOOK',
          autoSearch: data?.autoSearch ?? false,
        }}
        validationSchema={BookLoreSettingsSchema}
        onSubmit={async (values) => {
          try {
            await axios.post('/api/v1/settings/booklore', {
              enabled: values.enabled,
              hostname: values.hostname,
              port: Number(values.port),
              useSsl: values.useSsl,
              baseUrl: values.baseUrl,
              username: values.username,
              password: values.password,
              externalUrl: values.externalUrl,
              defaultFormat: values.defaultFormat,
              autoSearch: values.autoSearch,
            } as BookLoreSettings);

            addToast(intl.formatMessage(messages.bookloreSettingsSuccess), {
              autoDismiss: true,
              appearance: 'success',
            });
          } catch (e) {
            addToast(
              e?.response?.data?.message ??
                intl.formatMessage(messages.bookloreSettingsFailure),
              {
                autoDismiss: true,
                appearance: 'error',
              }
            );
          } finally {
            revalidate();
          }
        }}
      >
        {({
          errors,
          touched,
          values,
          setFieldValue,
          handleSubmit,
          isSubmitting,
          isValid,
        }) => {
          return (
            <form className="section" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="enabled" className="checkbox-label">
                  {intl.formatMessage(messages.bookloreEnabled)}
                </label>
                <div className="form-input-area">
                  <Field type="checkbox" id="enabled" name="enabled" />
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="hostname" className="text-label">
                  {intl.formatMessage(messages.bookloreHostname)}
                  <span className="label-required">*</span>
                  <span className="label-tip">
                    {intl.formatMessage(messages.bookloreHostnameTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <span className="protocol">
                      {values.useSsl ? 'https://' : 'http://'}
                    </span>
                    <Field
                      id="hostname"
                      name="hostname"
                      type="text"
                      inputMode="url"
                      className="rounded-r-only"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setIsValidated(false);
                        setFieldValue('hostname', e.target.value);
                      }}
                    />
                  </div>
                  {errors.hostname &&
                    touched.hostname &&
                    typeof errors.hostname === 'string' && (
                      <div className="error">{errors.hostname}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="port" className="text-label">
                  {intl.formatMessage(messages.booklorePort)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <Field
                    id="port"
                    name="port"
                    type="text"
                    inputMode="numeric"
                    className="short"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setIsValidated(false);
                      setFieldValue('port', e.target.value);
                    }}
                  />
                  {errors.port &&
                    touched.port &&
                    typeof errors.port === 'string' && (
                      <div className="error">{errors.port}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="useSsl" className="checkbox-label">
                  {intl.formatMessage(messages.bookloreSsl)}
                </label>
                <div className="form-input-area">
                  <Field
                    type="checkbox"
                    id="useSsl"
                    name="useSsl"
                    onChange={() => {
                      setIsValidated(false);
                      setFieldValue('useSsl', !values.useSsl);
                    }}
                  />
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="baseUrl" className="text-label">
                  {intl.formatMessage(messages.bookloreBaseUrl)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      id="baseUrl"
                      name="baseUrl"
                      type="text"
                      inputMode="url"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setIsValidated(false);
                        setFieldValue('baseUrl', e.target.value);
                      }}
                    />
                  </div>
                  {errors.baseUrl &&
                    touched.baseUrl &&
                    typeof errors.baseUrl === 'string' && (
                      <div className="error">{errors.baseUrl}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="username" className="text-label">
                  {intl.formatMessage(messages.bookloreUsername)}
                  <span className="label-required">*</span>
                  <span className="label-tip">
                    {intl.formatMessage(messages.bookloreUsernameTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      id="username"
                      name="username"
                      type="text"
                      autoComplete="off"
                      data-form-type="other"
                      data-1pignore="true"
                      data-lpignore="true"
                      data-bwignore="true"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setIsValidated(false);
                        setFieldValue('username', e.target.value);
                      }}
                    />
                  </div>
                  {errors.username &&
                    touched.username &&
                    typeof errors.username === 'string' && (
                      <div className="error">{errors.username}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="password" className="text-label">
                  {intl.formatMessage(messages.booklorePassword)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="password"
                      name="password"
                      type="password"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setIsValidated(false);
                        setFieldValue('password', e.target.value);
                      }}
                    />
                  </div>
                  {errors.password &&
                    touched.password &&
                    typeof errors.password === 'string' && (
                      <div className="error">{errors.password}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="externalUrl" className="text-label">
                  {intl.formatMessage(messages.bookloreExternalUrl)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      id="externalUrl"
                      name="externalUrl"
                      type="text"
                      inputMode="url"
                    />
                  </div>
                  {errors.externalUrl &&
                    touched.externalUrl &&
                    typeof errors.externalUrl === 'string' && (
                      <div className="error">{errors.externalUrl}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="defaultFormat" className="text-label">
                  {intl.formatMessage(messages.bookloreDefaultFormat)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field as="select" id="defaultFormat" name="defaultFormat">
                      <option value="EBOOK">
                        {intl.formatMessage(messages.bookloreFormatEbook)}
                      </option>
                      <option value="AUDIOBOOK">
                        {intl.formatMessage(messages.bookloreFormatAudiobook)}
                      </option>
                      <option value="ANY">
                        {intl.formatMessage(messages.bookloreFormatAny)}
                      </option>
                    </Field>
                  </div>
                  {errors.defaultFormat &&
                    touched.defaultFormat &&
                    typeof errors.defaultFormat === 'string' && (
                      <div className="error">{errors.defaultFormat}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="autoSearch" className="checkbox-label">
                  {intl.formatMessage(messages.bookloreAutoSearch)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.bookloreAutoSearchTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <Field type="checkbox" id="autoSearch" name="autoSearch" />
                </div>
              </div>
              {isValidated && testResponse && (
                <div className="mt-4 text-sm text-green-500">
                  {intl.formatMessage(messages.bookloreTestConnected, {
                    count: testResponse.wantedCount,
                  })}
                </div>
              )}
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="warning"
                      disabled={
                        !values.hostname ||
                        !values.port ||
                        !values.username ||
                        !values.password ||
                        isTesting ||
                        isSubmitting
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        testConnection({
                          hostname: values.hostname,
                          port: values.port,
                          useSsl: values.useSsl,
                          baseUrl: values.baseUrl,
                          username: values.username,
                          password: values.password,
                        });
                      }}
                    >
                      <BeakerIcon />
                      <span>
                        {isTesting
                          ? intl.formatMessage(globalMessages.testing)
                          : intl.formatMessage(globalMessages.test)}
                      </span>
                    </Button>
                  </span>
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={
                        isSubmitting ||
                        !isValid ||
                        isTesting ||
                        (values.enabled && !isValidated)
                      }
                    >
                      <ArrowDownOnSquareIcon />
                      <span>
                        {isSubmitting
                          ? intl.formatMessage(globalMessages.saving)
                          : intl.formatMessage(globalMessages.save)}
                      </span>
                    </Button>
                  </span>
                </div>
              </div>
            </form>
          );
        }}
      </Formik>
    </>
  );
};

export default SettingsBookLore;
