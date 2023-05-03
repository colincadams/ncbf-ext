
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.type === "runExtension") {
    chrome.runtime
      .sendMessage({
        command: "getPageInfo",
        url: document.location,
      })
      .then((pageInfo) => {
        if (pageInfo.collection === "contacts" && pageInfo.detailsId) {
          const requestsForContact = chrome.runtime.sendMessage({
            command: "getRequestsForContact",
            collectionId: pageInfo.allCollections["bailrequests"],
            detailsId: pageInfo.detailsId,
          });
          console.log(requestsForContact);
        }
      });
  }
});
