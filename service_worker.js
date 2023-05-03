chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status == "complete") {
    chrome.tabs.sendMessage(tab.id, { type: "runExtension" });
  }
});

const query = (body) => {
  return chrome.storage.session
    .get("ncbf-ext:auth-token")
    .then(({ "ncbf-ext:auth-token": authToken }) =>
      fetch("https://www.bailfundapp.org/graphql", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          Authorization: authToken,
        },
      }).then((response) => response.json())
    );
};

// Get auth token
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // Skip if this was sent from the extension.
    if (details.frameId === -1) return;

    chrome.storage.session.set({
      "ncbf-ext:auth-token": details.requestHeaders.find(
        (header) => header.name === "Authorization"
      ).value,
    });
  },
  {
    urls: ["*://www.bailfundapp.org/graphql"],
  },
  ["requestHeaders", "extraHeaders"]
);

// Get org info
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Skip if this was sent from the extension.
    if (details.frameId === -1) return;

    // Skip if this is not getting organization info.
    const payload = parsePayload(details);
    if (payload.operationName !== "organization") return;

    const organizationId = payload.variables.organizationId;
    query(
      JSON.stringify({
        query:
          "query organization($organizationId: ID!) {\n  organization(organizationId: $organizationId) {\n    bailFundSlug\n    features {\n      enabled\n      extra\n      flag\n      __typename\n    }\n    organizationId\n    name\n    fullName\n    timezone\n    legalDocsSigned\n    collectionOrder\n    collections {\n      actions {\n        navigation\n        deleteDocument\n        searchDialog\n        __typename\n      }\n      fields {\n        ...CompleteField\n        __typename\n      }\n      forms\n      id\n      pdfs {\n        title\n        sourcePdfUrl\n        fieldMapping {\n          pdfFieldName\n          slug\n          __typename\n        }\n        __typename\n      }\n      slug\n      title\n      views {\n        ...CompleteView\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment CompleteField on FieldDefinition {\n  availableOperators\n  defaultValue\n  enums\n  fieldType\n  widget\n  hiddenEnums\n  id\n  required\n  slug\n  title\n}\n\nfragment CompleteView on ViewDefinitionOutput {\n  default\n  id\n  name\n  schema {\n    fields\n    order\n    mode\n    expression {\n      operator\n      filters {\n        ...CompleteFilter\n        __typename\n      }\n      expressions {\n        operator\n        filters {\n          ...CompleteFilter\n          __typename\n        }\n        expressions {\n          operator\n          filters {\n            ...CompleteFilter\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment CompleteFilter on SchemaViewFilterOutput {\n  field\n  operands\n  operation\n}\n",
        operationName: "organization",
        variables: {
          organizationId: organizationId,
        },
      })
    ).then((json) => {
      const collections = json.data.organization.collections.reduce(
        (acc, value) => {
          acc[value.id] = value.slug;
          return acc;
        },
        {}
      );
      chrome.storage.session.set({
        "ncbf-ext:organization-id": organizationId,
        "ncbf-ext:collections": collections,
      });
    });
  },
  {
    urls: ["*://www.bailfundapp.org/graphql"],
  },
  ["requestBody"]
);

const getPageInfoForUrl = (url) => {
  const parts = url.pathname.split("/").reduce((acc, value, index, array) => {
    if (index % 2 === 1) {
      acc[array[index]] = array[index + 1];
    }
    return acc;
  }, {});
  // TODO: might this be undefined?
  return chrome.storage.session
    .get("ncbf-ext:collections")
    .then(
      ({ "ncbf-ext:collections": collections }) => {
        return {
          collections,
          flippedCollections: Object.fromEntries(
            Object.entries(collections).map(([key, value]) => [value, key])
          ),
        };
      },
      (reason) => console.log(reason)
    )
    .then(({ collections, flippedCollections }) => ({
      allCollections: flippedCollections,
      collectionId: parts["c"],
      collection: collections[parts["c"]],
      detailsId: parts["d"],
    }));
};

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log(
    sender.tab
      ? "from a content script:" + sender.tab.url
      : "from the extension"
  );
  if (request.command === "getPageInfo") {
    // TODO: something if we can't tell it what page it is yet
    getPageInfoForUrl(request.url).then(sendResponse, (reason) =>
      console.log("failure", reason)
    );
    return true;
  }
  if (request.command === "getRequestsForContact") {
    query(
      JSON.stringify({
        query:
          "query documentsForTabularView($collectionId: ID!, $query: QueryInput!) {\n queryResults( \ncollectionId: $collectionId, query: $query) {\n totalCount\n rowsPerPage\n page\n documents {\n document {\n collectionId\n version\n id\n created\n updated\n fieldsAsDict\n __typename\n }\n __typename\n }\n __typename\n }\n }",
        operationName: "",
        variables: {
          collectionId: request.collectionId,
          query: {
            page: 0,
            rowsPerPage: 25,
            expression: {
              operator: "AND",
              filters: [
                {
                  operation: "is_equal_to",
                  field: "attorney_id",
                  operands: [request.detailsId],
                },
              ],
              // TODO: or volunteer
            },
          },
        },
      })
    ).then((json) => sendResponse(json.data.queryResults.documents));
    return true;
  }
});

const parsePayload = (details) => {
  return JSON.parse(
    decodeURIComponent(
      String.fromCharCode.apply(
        null,
        new Uint8Array(details.requestBody.raw[0].bytes)
      )
    )
  );
};
