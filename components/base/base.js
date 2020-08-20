const ipcRenderer = require("electron").ipcRenderer;
const Swal = require("sweetalert2");

// Constants
ICON_ERROR = 0x274c;
ICON_SUCCESS = 0x2714;
ICON_RETRY = 0x1f504;
const VIEW_MAP = {
  "btn-search": {
    title: "SEARCH AMAZON ITEMS",
    id: "search",
  },
  "btn-bookmarks": {
    title: "MY BOOKMARKS",
    id: "bookmarks",
  },
  "btn-settings": {
    title: "SETTINGS",
    html: "settings",
  },
};

// State Variables
let navigationBtn; // Current navigation page.
let categories = [];
let items = [];
let filteredItems = [];

window.addEventListener("load", async () => {
  initView();

  // Check if category db can be updated
  var result = await checkCategoryDb();
  await sleep(6000);
  if (!result.error && result.canUpdate) {
    await updateCategoryDb();
    await sleep(6000);
  } else {
    $("#toast-2").remove();
  }

  // Check if item db can be updated
  const itemDb = await checkItemDb();
  await sleep(6000);
  if (!itemDb.error && itemDb.canUpdate) {
    await updateItemDb();
    await sleep(6000);
  } else {
    $("#toast-4").remove();
  }

  // Load Categories
  var result = await fetchCategories();
  if (!result.error) {
    categories = result.categories;
    console.log(categories);
  }

  // Load Items
  var result = await fetchItems();
  if (!result.error) {
    items = result.items;
    console.log(items);
  }

  updateItemsContainer(items, categories);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function initView() {
  console.log("Loaded Base JS.  Loading View...");
  navigationBtn = $("#btn-search");
  $("#main-title").text("SEARCH AMAZON ITEMS");
  navigationBtn.prop("disabled", true);
}

function updateView(btn) {
  console.log("Navigation Changed: Update View");
  const btnID = btn.getAttribute("id");
  const button = $(`#${btnID}`).prop("disabled", true);
  navigationBtn.prop("disabled", false);
  navigationBtn = button;
  $("#main").load(VIEW_MAP[btnID]["id"]);
  $("#main-title").text(VIEW_MAP[btnID]["title"]);
}

function updateToast(
  toast,
  { icon = null, iconIsEmoji = true, title = null, body = null, muted = null }
) {
  if (icon) {
    toast.find(".toast-icon").empty();
    if (iconIsEmoji) {
      toast.find(".toast-icon").text(String.fromCodePoint(icon));
    } else {
      toast.find(".toast-icon").html(icon);
    }
  }
  if (title) {
    toast.find(".toast-title > strong").text(title);
  }
  if (body) {
    toast.find(".toast-body").text(body);
  }
  if (muted) {
    toast.find("text-muted").text(muted);
  }
}

function handleError(result, toast, toastTitle, toastMsg, retry) {
  // Display Error Popup and Show Failure in Toast
  console.log(`Show Error to Display! ${result.msg}`);
  setTimeout(() => {
    Swal.fire({
      title: "An Error Occurred!",
      text: `${result.msg}`,
      icon: "error",
      showCancelButton: true,
      confirmButtonText: "Retry",
      cancelButtonText: "Cancel",
    }).then(async (result) => {
      if (result.value) {
        await retry();
      }
    });
    updateToast(toast, {
      icon: ICON_ERROR,
      title: toastTitle,
      body: toastMsg,
    });
  }, 2500);
}

function handleOk(toast, toastTitle, toastMsg) {
  // Update Toast and Hide Toast
  setTimeout(() => {
    updateToast(toast, {
      icon: ICON_SUCCESS,
      title: toastTitle,
      body: toastMsg,
    });
  }, 2500);
  setTimeout(() => {
    toast.toast("hide");
    toast.remove();
  }, 5000);
}

async function checkCategoryDb() {
  // Display Toast
  const notification = $("#toast-1");
  updateToast(notification, {
    icon: `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Loading...</span></div>`,
    iconIsEmoji: false,
    title: "Checking For Update",
    body: `Checking if the Category database needs an update...`,
  });
  notification.toast("show");

  // Determine if Can Update
  const result = await ipcRenderer.invoke("check-update:categories");
  console.log(`Result: ${JSON.stringify(result)}`);
  if (result.error) {
    handleError(
      result,
      notification,
      "Error: Checking For Update",
      "Failed to determine if the Category database could be updated.",
      checkCategoryDb
    );
  } else {
    // Show Success in Toast and Then Hide Toast
    handleOk(
      notification,
      `Category Database ${result.canUpdate ? "Needs Update" : "OK"}`,
      result.msg
    );
  }

  return result;
}

async function updateCategoryDb() {
  // Display Toast
  const notification = $("#toast-2");
  updateToast(notification, {
    icon: `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Retrieving Data...</span></div>`,
    iconIsEmoji: false,
    title: "Updating Category Database",
    body: `It's time for an update!  Updating the Category database...`,
  });
  notification.toast("show");

  // Retrieve Results
  const result = await ipcRenderer.invoke("update-db:categories");
  console.log(`Result: ${JSON.stringify(result)}`);
  if (result.error) {
    handleError(
      result,
      notification,
      "Error: Updating Category Database",
      "Failed to update the category database.",
      updateCategoryDb
    );
  } else {
    handleOk(notification, "Updated Category Database", result.msg);
  }

  return result;
}

async function checkItemDb() {
  // Display Toast
  const notification = $("#toast-3");
  updateToast(notification, {
    icon: `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Loading...</span></div>`,
    iconIsEmoji: false,
    title: "Checking For Update",
    body: `Checking if the Item database needs an update...`,
  });
  notification.toast("show");

  // Determine if Can Update
  const result = await ipcRenderer.invoke("check-update:items");
  console.log(`Result: ${JSON.stringify(result)}`);
  if (result.error) {
    handleError(
      result,
      notification,
      "Error: Checking For Update",
      "Failed to determine if the Item database could be updated.",
      checkCategoryDb
    );
  } else {
    // Show Success in Toast and Then Hide Toast
    handleOk(notification, `Item Database ${result.canUpdate ? "Needs Update" : "OK"}`, result.msg);
  }

  return result;
}

async function updateItemDb() {
  // Display Toast
  const notification = $("#toast-4");
  updateToast(notification, {
    icon: `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Retrieving Data...</span></div>`,
    iconIsEmoji: false,
    title: "Updating Item Database",
    body: `It's time for an update!  Updating the Item database...`,
  });
  notification.toast("show");

  // Retrieve Results
  const result = await ipcRenderer.invoke("update-db:items");
  console.log(`Result: ${JSON.stringify(result)}`);
  if (result.error) {
    handleError(
      result,
      notification,
      "Error: Updating Item Database",
      "Failed to update the item database.",
      updateCategoryDb
    );
  } else {
    handleOk(notification, "Updated Item Database", result.msg);
  }

  return result;
}

async function fetchCategories() {
  // Fetch Categories
  const result = await ipcRenderer.invoke("fetch-db:categories");
  return result;
}

async function fetchItems() {
  // Fetch Items
  const result = await ipcRenderer.invoke("fetch-db:items");
  console.log(result);
  return result;
}

// Dev Command
async function wipeItemsDb() {
  const result = await ipcRenderer.invoke("wipe-db:items");
  console.log(result);
  return result;
}

ipcRenderer.on("update:category", (event, message) => {
  const notification = $("#toast-2");
  updateToast(notification, { body: message });
});

ipcRenderer.on("update:item", (event, message, current, total) => {
  const notification = $("#toast-4");
  const completion = Math.round(current / total);
  updateToast(notification, { body: message });
  $("#toast-4 .progress-bar").attr("style", `width: ${completion}%;`);
});
