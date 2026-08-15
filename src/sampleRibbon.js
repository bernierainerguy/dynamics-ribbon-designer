export const sampleRibbonXml = `<?xml version="1.0" encoding="utf-8"?>
<RibbonDefinitions>
  <Ribbon Id="Mscrm.Form.account">
    <Tabs><Tab Id="Mscrm.Form.account.MainTab"><Groups><Group Id="Mscrm.Form.account.MainTab.Actions"><Controls>
      <Button Id="Mscrm.Form.account.Save" Command="Mscrm.SavePrimary" LabelText="Save" ToolTipDescription="Save this account" />
      <Button Id="Mscrm.Form.account.Delete" Command="Mscrm.DeletePrimary" LabelText="Delete" ToolTipDescription="Delete this account" />
      <Button Id="Mscrm.Form.account.Assign" Command="Mscrm.AssignPrimary" LabelText="Assign" ToolTipDescription="Assign this account" />
    </Controls></Group></Groups></Tab></Tabs>
  </Ribbon>
  <Ribbon Id="Mscrm.HomepageGrid.account">
    <Tabs><Tab Id="Mscrm.HomepageGrid.account.MainTab"><Groups><Group Id="Mscrm.HomepageGrid.account.MainTab.Actions"><Controls>
      <Button Id="Mscrm.HomepageGrid.account.NewRecord" Command="Mscrm.NewRecordFromGrid" LabelText="New" ToolTipDescription="Create an account" />
      <Button Id="Mscrm.HomepageGrid.account.DeleteMenu" Command="Mscrm.DeleteSelectedRecord" LabelText="Delete" ToolTipDescription="Delete selected accounts" />
      <Button Id="Mscrm.HomepageGrid.account.ExportToExcel" Command="Mscrm.ExportToExcel" LabelText="Export to Excel" ToolTipDescription="Export this view" />
    </Controls></Group></Groups></Tab></Tabs>
  </Ribbon>
  <Ribbon Id="Mscrm.SubGrid.account">
    <Tabs><Tab Id="Mscrm.SubGrid.account.MainTab"><Groups><Group Id="Mscrm.SubGrid.account.MainTab.Actions"><Controls>
      <Button Id="Mscrm.SubGrid.account.AddNewStandard" Command="Mscrm.AddNewRecordFromSubGridStandard" LabelText="New Account" />
      <Button Id="Mscrm.SubGrid.account.AddExistingStandard" Command="Mscrm.AddExistingRecordFromSubGridStandard" LabelText="Add Existing Account" />
    </Controls></Group></Groups></Tab></Tabs>
  </Ribbon>
</RibbonDefinitions>`;
