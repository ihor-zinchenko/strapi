import * as React from 'react';

import {
  Main,
  ActionLayout,
  Button,
  ContentLayout,
  HeaderLayout,
  Flex,
  Td,
  Tr,
  Typography,
  Status,
  lightTheme,
  ButtonProps,
} from '@strapi/design-system';
import { Link } from '@strapi/design-system/v2';
import {
  SearchURLQuery,
  useFocusWhenNavigate,
  useQueryParams,
  useNotification,
  useTracking,
  useAPIErrorHandler,
  useStrapiApp,
  PaginationURLQuery,
  PageSizeURLQuery,
  LoadingIndicatorPage,
  AnErrorOccurred,
  CheckPagePermissions,
} from '@strapi/helper-plugin';
import { ArrowLeft, Plus } from '@strapi/icons';
import { stringify } from 'qs';
import { useIntl } from 'react-intl';
import { useNavigate, Link as ReactRouterLink } from 'react-router-dom';

import { InjectionZone } from '../../../components/InjectionZone';
import { HOOKS } from '../../../constants';
import { useEnterprise } from '../../../hooks/useEnterprise';
import { DocumentActionsRBAC, useDocumentActionsRBAC } from '../../features/DocumentActionsRBAC';
import { useDoc } from '../../hooks/useDocument';
import {
  ListFieldLayout,
  convertListLayoutToFieldLayouts,
  useDocumentLayout,
} from '../../hooks/useDocumentLayout';
import { useSyncRbac } from '../../hooks/useSyncRbac';
import { useDeleteDocumentMutation, useGetAllDocumentsQuery } from '../../services/documents';
import { buildValidParams } from '../../utils/api';
import { getTranslation } from '../../utils/translations';
import { getDisplayName } from '../../utils/users';

import { Filters } from './components/Filters';
import { Table } from './components/Table';
import { CellContent } from './components/TableCells/CellContent';
import { ViewSettingsMenu } from './components/ViewSettingsMenu';

import type { Documents } from '@strapi/types';

const { INJECT_COLUMN_IN_TABLE } = HOOKS;
const REVIEW_WORKFLOW_COLUMNS_CE = null;
const REVIEW_WORKFLOW_COLUMNS_CELL_CE = {
  ReviewWorkflowsStageEE: () => null,
  ReviewWorkflowsAssigneeEE: () => null,
};

/* -------------------------------------------------------------------------------------------------
 * ListViewPage
 * -----------------------------------------------------------------------------------------------*/

const ListViewPage = () => {
  const { trackUsage } = useTracking();
  const navigate = useNavigate();
  const { formatMessage } = useIntl();
  const toggleNotification = useNotification();
  useFocusWhenNavigate();
  const { _unstableFormatAPIError: formatAPIError } = useAPIErrorHandler(getTranslation);

  const [isConfirmDeleteRowOpen, setIsConfirmDeleteRowOpen] = React.useState(false);

  const { model, schema } = useDoc();
  const { list } = useDocumentLayout(model);
  const [displayedHeaders, setDisplayedHeaders] = React.useState<ListFieldLayout[]>([]);

  React.useEffect(() => {
    setDisplayedHeaders(list.schema);
  }, [list.schema]);

  const handleSetHeaders = (headers: string[]) => {
    setDisplayedHeaders(
      convertListLayoutToFieldLayouts(headers, schema!.attributes, list.metadatas)
    );
  };

  const [{ query, rawQuery }] = useQueryParams<{
    plugins?: Record<string, unknown>;
    page?: string;
    pageSize?: string;
    sort?: string;
  }>({
    page: '1',
    pageSize: list.settings.pageSize.toString(),
    sort: list.settings.defaultSortBy
      ? `${list.settings.defaultSortBy}:${list.settings.defaultSortOrder}`
      : '',
  });

  const params = React.useMemo(() => buildValidParams(query), [query]);
  const { data, error, isLoading } = useGetAllDocumentsQuery({
    model,
    params,
  });

  /**
   * If the API returns an error, display a notification
   */
  React.useEffect(() => {
    if (error) {
      toggleNotification({
        type: 'warning',
        message: formatAPIError(error),
      });
    }
  }, [error, formatAPIError, toggleNotification]);

  const { results = [], pagination } = data ?? {};

  React.useEffect(() => {
    if (pagination && pagination.page > pagination.pageCount) {
      navigate(
        {
          search: stringify({
            ...query,
            page: pagination.pageCount,
          }),
        },
        { replace: true }
      );
    }
  }, [pagination, formatMessage, query, navigate]);

  const { canCreate } = useDocumentActionsRBAC('ListViewPage', ({ canCreate }) => ({
    canCreate,
  }));

  /* -------------------------------------------------------------------------------------------------
   * Create all our table headers and run the hook for plugins to inject.
   * -----------------------------------------------------------------------------------------------*/
  const reviewWorkflowColumns = useEnterprise(
    REVIEW_WORKFLOW_COLUMNS_CE,
    async () =>
      (await import('../../../../../ee/admin/src/content-manager/pages/ListView/constants'))
        .REVIEW_WORKFLOW_COLUMNS_EE,
    {
      enabled: schema?.options?.reviewWorkflows,
    }
  );
  const ReviewWorkflowsColumns = useEnterprise(
    REVIEW_WORKFLOW_COLUMNS_CELL_CE,
    async () => {
      const { ReviewWorkflowsStageEE, ReviewWorkflowsAssigneeEE } = await import(
        '../../../../../ee/admin/src/content-manager/pages/ListView/components/ReviewWorkflowsColumn'
      );
      return { ReviewWorkflowsStageEE, ReviewWorkflowsAssigneeEE };
    },
    {
      enabled: schema?.options?.reviewWorkflows,
    }
  );

  const { runHookWaterfall } = useStrapiApp();
  /**
   * Run the waterfall and then inject our additional table headers.
   */
  const tableHeaders = React.useMemo(() => {
    const headers = runHookWaterfall(INJECT_COLUMN_IN_TABLE, {
      displayedHeaders,
      layout: list,
    });

    const formattedHeaders = headers.displayedHeaders.map<ListFieldLayout>((header) => {
      return {
        ...header,
        name: `${header.name}${header.mainField ? `.${header.mainField}` : ''}`,
      };
    });

    formattedHeaders.push({
      attribute: {
        type: 'custom',
      },
      name: 'publishedAt',
      label: {
        id: getTranslation(`containers.ListPage.table-headers.publishedAt`),
        defaultMessage: 'publishedAt',
      },
      searchable: false,
      sortable: true,
    } satisfies ListFieldLayout);

    if (reviewWorkflowColumns) {
      formattedHeaders.push(...reviewWorkflowColumns);
    }
    return formattedHeaders;
  }, [displayedHeaders, list, reviewWorkflowColumns, runHookWaterfall]);

  /* -------------------------------------------------------------------------------------------------
   * Methods
   * -----------------------------------------------------------------------------------------------*/
  const [deleteDocument] = useDeleteDocumentMutation();
  const handleConfirmDeleteData = React.useCallback(
    async (idToDelete: Documents.ID) => {
      try {
        const res = await deleteDocument({
          model,
          collectionType: 'collection-types',
          id: idToDelete,
        });
        if ('error' in res) {
          toggleNotification({
            type: 'warning',
            message: formatAPIError(res.error),
          });
          return;
        }
        toggleNotification({
          type: 'success',
          message: {
            id: getTranslation('success.record.delete'),
            defaultMessage: 'Deleted document',
          },
        });
      } catch (err) {
        toggleNotification({
          type: 'warning',
          message: {
            id: 'notification.error',
            defaultMessage: "Couldn't delete document, an error occurred.",
          },
        });
      }
    },
    [deleteDocument, model, toggleNotification, formatAPIError]
  );

  if (isLoading) {
    return (
      <Main aria-busy={true}>
        <LoadingIndicatorPage />
      </Main>
    );
  }

  if (error) {
    return (
      <Main height="100%">
        <Flex alignItems="center" height="100%" justifyContent="center">
          <AnErrorOccurred />
        </Flex>
      </Main>
    );
  }

  const contentTypeTitle = schema?.info.displayName ?? 'Untitled';

  const handleRowClick = (id: Documents.ID) => () => {
    trackUsage('willEditEntryFromList');
    navigate({
      pathname: id.toString(),
      search: stringify({ plugins: query.plugins }),
    });
  };

  return (
    <Main>
      <HeaderLayout
        primaryAction={canCreate ? <CreateButton /> : null}
        subtitle={formatMessage(
          {
            id: getTranslation('pages.ListView.header-subtitle'),
            defaultMessage:
              '{number, plural, =0 {# entries} one {# entry} other {# entries}} found',
          },
          { number: pagination?.total }
        )}
        title={contentTypeTitle}
        navigationAction={
          /**
           * TODO: sort out back link behaviour, part of https://strapi-inc.atlassian.net/browse/CONTENT-2173
           */
          <Link startIcon={<ArrowLeft />}>
            {formatMessage({
              id: 'global.back',
              defaultMessage: 'Back',
            })}
          </Link>
        }
      />
      <ActionLayout
        endActions={
          <>
            <InjectionZone area="contentManager.listView.actions" />
            <ViewSettingsMenu
              setHeaders={handleSetHeaders}
              resetHeaders={() => setDisplayedHeaders(list.schema)}
              headers={displayedHeaders.map((header) => header.name)}
            />
          </>
        }
        startActions={
          <>
            {list.settings.searchable && (
              <SearchURLQuery
                disabled={results.length === 0}
                label={formatMessage(
                  { id: 'app.component.search.label', defaultMessage: 'Search for {target}' },
                  { target: contentTypeTitle }
                )}
                placeholder={formatMessage({
                  id: 'global.search',
                  defaultMessage: 'Search',
                })}
                trackedEvent="didSearch"
              />
            )}
            {list.settings.filterable && schema ? (
              <Filters disabled={results.length === 0} schema={schema} />
            ) : null}
          </>
        }
      />
      <ContentLayout>
        <Flex gap={4} direction="column" alignItems="stretch">
          <Table.Root rows={results} isLoading={isLoading} colCount={tableHeaders.length + 2}>
            <Table.ActionBar />
            <Table.Content>
              <Table.Head>
                {/* Bulk action select all checkbox */}
                <Table.HeaderCheckboxCell />
                {/* Dynamic headers based on fields */}
                {results.length > 0 &&
                  tableHeaders.map((header) => <Table.HeaderCell key={header.name} {...header} />)}
              </Table.Head>
              {/* Loading content */}
              <Table.LoadingBody />
              {/* Empty content */}
              <Table.EmptyBody
                contentType={contentTypeTitle}
                action={canCreate ? <CreateButton variant="secondary" /> : null}
              />
              {/* Content */}
              <Table.Body
                onConfirmDelete={handleConfirmDeleteData}
                isConfirmDeleteRowOpen={isConfirmDeleteRowOpen}
                setIsConfirmDeleteRowOpen={setIsConfirmDeleteRowOpen}
              >
                {results.map((rowData, index) => {
                  return (
                    <Tr cursor="pointer" key={rowData.id} onClick={handleRowClick(rowData.id)}>
                      <Td>
                        <Table.CheckboxDataCell rowId={rowData.id} index={index} />
                      </Td>
                      {tableHeaders.map(({ cellFormatter, ...header }) => {
                        if (header.name === 'publishedAt') {
                          return (
                            <Td key={header.name}>
                              <Status
                                width="min-content"
                                showBullet={false}
                                variant={rowData.publishedAt ? 'success' : 'secondary'}
                                size="S"
                              >
                                <Typography
                                  fontWeight="bold"
                                  textColor={`${rowData.publishedAt ? 'success' : 'secondary'}700`}
                                >
                                  {formatMessage({
                                    id: getTranslation(
                                      `containers.List.${
                                        rowData.publishedAt ? 'published' : 'draft'
                                      }`
                                    ),
                                    defaultMessage: rowData.publishedAt ? 'Published' : 'Draft',
                                  })}
                                </Typography>
                              </Status>
                            </Td>
                          );
                        }
                        if (schema?.options?.reviewWorkflows) {
                          if (header.name === 'strapi_stage') {
                            return (
                              <Td key={header.name}>
                                {rowData.strapi_stage ? (
                                  <ReviewWorkflowsColumns.ReviewWorkflowsStageEE
                                    color={
                                      rowData.strapi_stage.color ?? lightTheme.colors.primary600
                                    }
                                    name={rowData.strapi_stage.name}
                                  />
                                ) : (
                                  <Typography textColor="neutral800">-</Typography>
                                )}
                              </Td>
                            );
                          }
                          if (header.name === 'strapi_assignee') {
                            return (
                              <Td key={header.name}>
                                {rowData.strapi_assignee ? (
                                  <ReviewWorkflowsColumns.ReviewWorkflowsAssigneeEE
                                    user={rowData.strapi_assignee}
                                  />
                                ) : (
                                  <Typography textColor="neutral800">-</Typography>
                                )}
                              </Td>
                            );
                          }
                        }
                        if (['createdBy', 'updatedBy'].includes(header.name.split('.')[0])) {
                          // Display the users full name
                          // Some entries doesn't have a user assigned as creator/updater (ex: entries created through content API)
                          // In this case, we display a dash
                          return (
                            <Td key={header.name}>
                              <Typography textColor="neutral800">
                                {rowData[header.name.split('.')[0]]
                                  ? getDisplayName(
                                      rowData[header.name.split('.')[0]],
                                      formatMessage
                                    )
                                  : '-'}
                              </Typography>
                            </Td>
                          );
                        }
                        if (typeof cellFormatter === 'function') {
                          return <Td key={header.name}>{cellFormatter(rowData, header)}</Td>;
                        }
                        return (
                          <Td key={header.name}>
                            <CellContent
                              content={rowData[header.name.split('.')[0]]}
                              rowId={rowData.id}
                              {...header}
                            />
                          </Td>
                        );
                      })}
                    </Tr>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.Root>
          <Flex alignItems="flex-end" justifyContent="space-between">
            <PageSizeURLQuery trackedEvent="willChangeNumberOfEntriesPerPage" />
            <PaginationURLQuery pagination={{ pageCount: pagination?.pageCount || 1 }} />
          </Flex>
        </Flex>
      </ContentLayout>
    </Main>
  );
};

interface CreateButtonProps extends Pick<ButtonProps, 'variant'> {}

const CreateButton = ({ variant }: CreateButtonProps) => {
  const { formatMessage } = useIntl();
  const { trackUsage } = useTracking();
  const [{ rawQuery }] = useQueryParams();

  return (
    <Button
      variant={variant}
      forwardedAs={ReactRouterLink}
      onClick={() => {
        trackUsage('willCreateEntry', { status: 'draft' });
      }}
      startIcon={<Plus />}
      style={{ textDecoration: 'none' }}
      // @ts-expect-error – DS inference does not work with as or forwardedAs
      to={{
        pathname: 'create',
        search: rawQuery,
      }}
    >
      {formatMessage({
        id: getTranslation('HeaderLayout.button.label-add-entry'),
        defaultMessage: 'Create new entry',
      })}
    </Button>
  );
};

/* -------------------------------------------------------------------------------------------------
 * ProtectedListViewPage
 * -----------------------------------------------------------------------------------------------*/

const ProtectedListViewPage = () => {
  const { model } = useDoc();
  const [{ query }] = useQueryParams();
  const { permissions = [], isLoading, isError } = useSyncRbac(model, query, 'editView');

  if (isLoading) {
    return (
      <Main aria-busy={true}>
        <LoadingIndicatorPage />
      </Main>
    );
  }

  if (!isLoading && isError) {
    return (
      <Main height="100%">
        <Flex alignItems="center" height="100%" justifyContent="center">
          <AnErrorOccurred />
        </Flex>
      </Main>
    );
  }

  return (
    <CheckPagePermissions permissions={permissions}>
      <DocumentActionsRBAC permissions={permissions}>
        <ListViewPage />
      </DocumentActionsRBAC>
    </CheckPagePermissions>
  );
};

export { ListViewPage, ProtectedListViewPage };
